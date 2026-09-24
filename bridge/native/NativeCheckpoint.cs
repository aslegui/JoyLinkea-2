using System.Runtime.InteropServices;
using System.Diagnostics;
using HIDMaestro;

internal static class NativeCheckpoint
{
    private const string Identity = "joylinkea2-slot-1";
    private static readonly PadState Neutral = new(0,0,0,0,0,0,false,false,false,false,false,false,false,false,false,false,false,false,false,false);

    [StructLayout(LayoutKind.Sequential)]
    private struct XGamepad
    {
        public ushort Buttons;
        public byte LeftTrigger, RightTrigger;
        public short LeftX, LeftY, RightX, RightY;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct XState { public uint Packet; public XGamepad Gamepad; }
    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")]
    private static extern uint GetState(uint index, out XState state);

    private static bool Connected(int index) => GetState((uint)index, out _) == 0;
    internal static bool HasPresentHidMaestroDevice()
    {
        var psi = new ProcessStartInfo("pnputil.exe", "/enum-devices /connected") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("PNP_PROBE_START_FAILED");
        var output = process.StandardOutput.ReadToEnd();
        var error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0) throw new InvalidOperationException($"PNP_PROBE_FAILED_{process.ExitCode}: {error}");
        return output.Contains("HIDMaestro", StringComparison.OrdinalIgnoreCase);
    }
    private static XGamepad Read(int index)
    {
        var code = GetState((uint)index, out var state);
        if (code != 0) throw new InvalidOperationException($"XINPUT_READ_{code}");
        return state.Gamepad;
    }
    private static async Task WaitFor(Func<bool> predicate, string name, TextWriter log)
    {
        for (var i = 0; i < 40; i++)
        {
            if (predicate()) { log.WriteLine($"PASS {name}"); return; }
            await Task.Delay(50);
        }
        throw new InvalidOperationException($"FAIL {name}");
    }
    private static void Submit(HMController ctrl, PadState pad)
    {
        var state = NativeBridge.Map(pad, ctrl.Profile);
        ctrl.SubmitState(in state);
    }
    private static bool IsNeutral(XGamepad s) => s.Buttons == 0 && s.LeftTrigger == 0 && s.RightTrigger == 0 &&
        Math.Abs((int)s.LeftX) <= 1 && Math.Abs((int)s.LeftY) <= 1 && Math.Abs((int)s.RightX) <= 1 && Math.Abs((int)s.RightY) <= 1;

    public static object Probe() => new {
        pnpHidMaestroPresent = HasPresentHidMaestroDevice(),
        slots = Enumerable.Range(0, 4).Select(i => {
            var code = GetState((uint)i, out var state);
            var s = state.Gamepad;
            return new { index = i, connected = code == 0, buttons = s.Buttons, lt = s.LeftTrigger, rt = s.RightTrigger, lx = s.LeftX, ly = s.LeftY, rx = s.RightX, ry = s.RightY };
        }).ToArray()
    };

    public static async Task OneAsync(TextWriter log)
    {
        log.WriteLine("SDK=HIDMaestro 1.9.0; phase=one; identity=" + Identity);
        var baseline = Enumerable.Range(0,4).Where(Connected).ToArray();
        log.WriteLine("XInput baseline=" + string.Join(',', baseline));
        var pnpBefore = HasPresentHidMaestroDevice();
        log.WriteLine("PNP_HIDMAESTRO_BEFORE=" + pnpBefore);
        if (pnpBefore) throw new InvalidOperationException("PNP_RESIDUAL_BEFORE_CREATE");
        using var context = new HMContext();
        context.LoadDefaultProfiles();
        if (!context.IsDriverInstalled) throw new InvalidOperationException("DRIVER_NOT_INSTALLED");
        var profile = context.GetProfile("xbox-360-wired") ?? throw new InvalidOperationException("PROFILE_MISSING");
        HMController? ctrl = null;
        int? index = null;
        try
        {
            log.WriteLine("CREATE_ENTER identity=" + Identity);
            try
            {
                ctrl = context.CreateController(profile, Identity);
                log.WriteLine("CREATE_RETURN identity=" + ctrl.IdentityKey);
            }
            catch (Exception error)
            {
                log.WriteLine("CREATE_EXCEPTION " + error);
                throw;
            }
            Submit(ctrl, Neutral);
            await WaitFor(HasPresentHidMaestroDevice, "Windows PnP detects HIDMaestro", log);
            await WaitFor(() => Enumerable.Range(0,4).Count(i => Connected(i) && !baseline.Contains(i)) == 1, "one new XInput slot", log);
            index = Enumerable.Range(0,4).Single(i => Connected(i) && !baseline.Contains(i));
            log.WriteLine("XInput index=" + index);
            await WaitFor(() => IsNeutral(Read(index.Value)), "initial neutral", log);

            var checks = new (string Name, PadState State, Func<XGamepad,bool> Check)[] {
                ("A", Neutral with { A=true }, s => s.Buttons == 0x1000),
                ("B", Neutral with { B=true }, s => s.Buttons == 0x2000),
                ("X", Neutral with { X=true }, s => s.Buttons == 0x4000),
                ("Y", Neutral with { Y=true }, s => s.Buttons == 0x8000),
                ("Dpad up", Neutral with { Up=true }, s => s.Buttons == 0x0001),
                ("Dpad down", Neutral with { Down=true }, s => s.Buttons == 0x0002),
                ("Dpad left", Neutral with { Left=true }, s => s.Buttons == 0x0004),
                ("Dpad right", Neutral with { Right=true }, s => s.Buttons == 0x0008),
                ("Dpad north east", Neutral with { Up=true, Right=true }, s => s.Buttons == 0x0009),
                ("Dpad north west", Neutral with { Up=true, Left=true }, s => s.Buttons == 0x0005),
                ("Dpad south east", Neutral with { Down=true, Right=true }, s => s.Buttons == 0x000A),
                ("Dpad south west", Neutral with { Down=true, Left=true }, s => s.Buttons == 0x0006),
                ("L3", Neutral with { L3=true }, s => s.Buttons == 0x0040),
                ("R3", Neutral with { R3=true }, s => s.Buttons == 0x0080),
                ("LB", Neutral with { LB=true }, s => s.Buttons == 0x0100),
                ("RB", Neutral with { RB=true }, s => s.Buttons == 0x0200),
                ("LT analog", Neutral with { LeftTrigger=0.5 }, s => s.LeftTrigger >= 120 && s.LeftTrigger <= 136 && s.RightTrigger == 0),
                ("RT analog", Neutral with { RightTrigger=0.75 }, s => s.RightTrigger >= 184 && s.RightTrigger <= 200 && s.LeftTrigger == 0),
                ("left stick X", Neutral with { LeftX=0.8 }, s => s.LeftX > 20000 && Math.Abs((int)s.LeftY) <= 1),
                ("left stick Y down", Neutral with { LeftY=0.8 }, s => s.LeftY < -20000 && Math.Abs((int)s.LeftX) <= 1),
                ("right stick X", Neutral with { RightX=-0.8 }, s => s.RightX < -20000 && Math.Abs((int)s.RightY) <= 1),
                ("right stick Y up", Neutral with { RightY=-0.8 }, s => s.RightY > 20000 && Math.Abs((int)s.RightX) <= 1),
                ("Back", Neutral with { Back=true }, s => s.Buttons == 0x0020),
                ("Start", Neutral with { Start=true }, s => s.Buttons == 0x0010)
            };
            foreach (var (name, pad, check) in checks)
            {
                Submit(ctrl, pad);
                await WaitFor(() => check(Read(index.Value)), name, log);
                Submit(ctrl, Neutral);
                await WaitFor(() => IsNeutral(Read(index.Value)), name + " release", log);
            }
            Submit(ctrl, Neutral);
            await WaitFor(() => IsNeutral(Read(index.Value)), "final neutral", log);
        }
        finally
        {
            if (ctrl != null)
            {
                try { Submit(ctrl, Neutral); log.WriteLine("NEUTRALIZED before destroy"); }
                catch (Exception error) { log.WriteLine("NEUTRALIZE_ERROR " + error); }
                try { ctrl.Dispose(); log.WriteLine("DESTROYED"); }
                catch (Exception error) { log.WriteLine("DESTROY_ERROR " + error); }
            }
        }
        if (index.HasValue) await WaitFor(() => !Connected(index.Value), "XInput removed", log);
        await WaitFor(() => !HasPresentHidMaestroDevice(), "Windows PnP removed", log);
        var after = Enumerable.Range(0,4).Where(Connected).ToArray();
        if (!after.SequenceEqual(baseline)) throw new InvalidOperationException("XINPUT_BASELINE_NOT_RESTORED");
        log.WriteLine("PHASE_ONE_OK");
    }

    public static async Task LifecycleAsync(TextWriter log)
    {
        log.WriteLine("SDK=HIDMaestro 1.9.0; phase=lifecycle; identity=" + Identity);
        var baseline = Enumerable.Range(0, 4).Where(Connected).ToArray();
        if (HasPresentHidMaestroDevice()) throw new InvalidOperationException("PNP_RESIDUAL_BEFORE_CREATE");
        log.WriteLine("XInput baseline=" + string.Join(',', baseline));
        using var context = new HMContext();
        context.LoadDefaultProfiles();
        if (!context.IsDriverInstalled) throw new InvalidOperationException("DRIVER_NOT_INSTALLED");
        var profile = context.GetProfile("xbox-360-wired") ?? throw new InvalidOperationException("PROFILE_MISSING");
        for (var iteration = 1; iteration <= 2; iteration++)
        {
            HMController? ctrl = null;
            int? index = null;
            log.WriteLine($"CYCLE_{iteration}_CREATE_ENTER identity={Identity}");
            try
            {
                try
                {
                    ctrl = context.CreateController(profile, Identity);
                    log.WriteLine($"CYCLE_{iteration}_CREATE_RETURN identity={ctrl.IdentityKey}");
                }
                catch (Exception error)
                {
                    log.WriteLine($"CYCLE_{iteration}_CREATE_EXCEPTION {error}");
                    throw;
                }
                Submit(ctrl, Neutral);
                await WaitFor(HasPresentHidMaestroDevice, $"cycle {iteration} PnP present", log);
                await WaitFor(() => Enumerable.Range(0, 4).Count(i => Connected(i) && !baseline.Contains(i)) == 1, $"cycle {iteration} exactly one XInput slot", log);
                index = Enumerable.Range(0, 4).Single(i => Connected(i) && !baseline.Contains(i));
                log.WriteLine($"CYCLE_{iteration}_XINPUT_INDEX={index}");
                await WaitFor(() => IsNeutral(Read(index.Value)), $"cycle {iteration} initial neutral", log);
                Submit(ctrl, Neutral with { A = true, LeftTrigger = 0.5 });
                await WaitFor(() => Read(index.Value) is var s && s.Buttons == 0x1000 && s.LeftTrigger is >= 120 and <= 136, $"cycle {iteration} input", log);
                Submit(ctrl, Neutral);
                await WaitFor(() => IsNeutral(Read(index.Value)), $"cycle {iteration} neutral", log);
            }
            finally
            {
                if (ctrl != null)
                {
                    try { Submit(ctrl, Neutral); log.WriteLine($"CYCLE_{iteration}_NEUTRALIZED"); }
                    catch (Exception error) { log.WriteLine($"CYCLE_{iteration}_NEUTRALIZE_ERROR {error}"); }
                    try { ctrl.Dispose(); log.WriteLine($"CYCLE_{iteration}_DESTROYED"); }
                    catch (Exception error) { log.WriteLine($"CYCLE_{iteration}_DESTROY_ERROR {error}"); throw; }
                }
            }
            if (index.HasValue) await WaitFor(() => !Connected(index.Value), $"cycle {iteration} XInput removed", log);
            await WaitFor(() => !HasPresentHidMaestroDevice(), $"cycle {iteration} PnP removed", log);
            if (!Enumerable.Range(0, 4).Where(Connected).SequenceEqual(baseline)) throw new InvalidOperationException("XINPUT_BASELINE_NOT_RESTORED");
            log.WriteLine($"CYCLE_{iteration}_OK");
        }
        log.WriteLine("PHASE_LIFECYCLE_OK");
    }

    public static async Task MultipleAsync(TextWriter log)
    {
        log.WriteLine("SDK=HIDMaestro 1.9.0; phase=multiple");
        var baseline = Enumerable.Range(0, 4).Where(Connected).ToArray();
        log.WriteLine("XInput baseline=" + string.Join(',', baseline));
        if (HasPresentHidMaestroDevice()) throw new InvalidOperationException("PNP_RESIDUAL_BEFORE_CREATE");
        using var context = new HMContext();
        context.LoadDefaultProfiles();
        if (!context.IsDriverInstalled) throw new InvalidOperationException("DRIVER_NOT_INSTALLED");
        var profile = context.GetProfile("xbox-360-wired") ?? throw new InvalidOperationException("PROFILE_MISSING");
        var available = 4 - baseline.Length;
        if (available < 2) throw new InvalidOperationException("FEWER_THAN_TWO_FREE_XINPUT_SLOTS");
        for (var count = 2; count <= Math.Min(4, available); count++)
        {
            var controls = new List<HMController>();
            var indices = new List<int>();
            log.WriteLine($"GROUP_{count}_BEGIN");
            try
            {
                for (var slot = 1; slot <= count; slot++)
                {
                    var identity = $"joylinkea2-slot-{slot}";
                    log.WriteLine($"GROUP_{count}_CREATE_ENTER identity={identity}");
                    HMController ctrl;
                    try
                    {
                        ctrl = context.CreateController(profile, identity);
                        log.WriteLine($"GROUP_{count}_CREATE_RETURN identity={ctrl.IdentityKey}");
                    }
                    catch (Exception error) { log.WriteLine($"GROUP_{count}_CREATE_EXCEPTION {error}"); throw; }
                    controls.Add(ctrl);
                    Submit(ctrl, Neutral);
                    var expected = slot;
                    await WaitFor(() => Enumerable.Range(0, 4).Count(i => Connected(i) && !baseline.Contains(i)) == expected, $"group {count} XInput count {expected}", log);
                    var newIndex = Enumerable.Range(0, 4).Single(i => Connected(i) && !baseline.Contains(i) && !indices.Contains(i));
                    indices.Add(newIndex);
                    log.WriteLine($"GROUP_{count}_SLOT_{slot}_XINPUT_INDEX={newIndex}");
                    await WaitFor(() => IsNeutral(Read(newIndex)), $"group {count} slot {slot} initial neutral", log);
                }
                for (var slot = 1; slot <= count; slot++)
                {
                    var pad = slot switch {
                        1 => Neutral with { A = true, LeftTrigger = 0.25 },
                        2 => Neutral with { B = true, RightTrigger = 0.75 },
                        3 => Neutral with { X = true, LeftX = 0.8 },
                        _ => Neutral with { Y = true, RightX = -0.8 }
                    };
                    Submit(controls[slot - 1], pad);
                }
                await WaitFor(() =>
                    indices.Select(Read).Select((s, i) => i switch {
                        0 => s.Buttons == 0x1000 && s.LeftTrigger is >= 56 and <= 72 && s.RightTrigger == 0,
                        1 => s.Buttons == 0x2000 && s.RightTrigger is >= 184 and <= 200 && s.LeftTrigger == 0,
                        2 => s.Buttons == 0x4000 && s.LeftX > 20000,
                        _ => s.Buttons == 0x8000 && s.RightX < -20000
                    }).All(x => x), $"group {count} simultaneous independent input", log);
                foreach (var ctrl in controls) Submit(ctrl, Neutral);
                await WaitFor(() => indices.All(i => IsNeutral(Read(i))), $"group {count} all neutral", log);
            }
            finally
            {
                foreach (var ctrl in controls)
                {
                    try { Submit(ctrl, Neutral); ctrl.Dispose(); log.WriteLine($"GROUP_{count}_DESTROYED identity={ctrl.IdentityKey}"); }
                    catch (Exception error) { log.WriteLine($"GROUP_{count}_DESTROY_ERROR {error}"); throw; }
                }
            }
            await WaitFor(() => indices.All(i => !Connected(i)), $"group {count} XInput removed", log);
            await WaitFor(() => !HasPresentHidMaestroDevice(), $"group {count} PnP removed", log);
            if (!Enumerable.Range(0, 4).Where(Connected).SequenceEqual(baseline)) throw new InvalidOperationException("XINPUT_BASELINE_NOT_RESTORED");
            log.WriteLine($"GROUP_{count}_OK");
        }
        if (available < 4) log.WriteLine($"FOUR_VIRTUAL_SKIPPED free_XInput_slots={available}; baseline occupied={string.Join(',', baseline)}");
        log.WriteLine("PHASE_MULTIPLE_OK");
    }
}

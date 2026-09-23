using System.Runtime.InteropServices;
using HIDMaestro;

internal static class NativeCheckpoint
{
    private const string Identity = "joylinkea2-slot-1";
    private const int NotConnected = 1167;
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

    public static async Task OneAsync(TextWriter log)
    {
        log.WriteLine("SDK=HIDMaestro 1.9.0; phase=one; identity=" + Identity);
        var baseline = Enumerable.Range(0,4).Where(Connected).ToArray();
        log.WriteLine("XInput baseline=" + string.Join(',', baseline));
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
        var after = Enumerable.Range(0,4).Where(Connected).ToArray();
        if (!after.SequenceEqual(baseline)) throw new InvalidOperationException("XINPUT_BASELINE_NOT_RESTORED");
        log.WriteLine("PHASE_ONE_OK");
    }
}

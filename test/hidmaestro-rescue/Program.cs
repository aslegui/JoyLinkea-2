using System.Diagnostics;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using HIDMaestro;

// Standalone checkpoint only. Never referenced by the production Bridge.
const string Identity = "joylinkea2-slot-1";
if (args.Length > 0 && args[0] == "--watchdog") { await WatchdogAsync(args[1]); return; }
if (args.Length > 0 && args[0] == "--owner") { Owner(int.Parse(args[1]), long.Parse(args[2])); return; }
if (args.Length == 5 && args[0] == "--measure-external-kill")
{
    try { MeasureExternalKill(int.Parse(args[1]), long.Parse(args[2]), int.Parse(args[3]), args[4]); }
    catch (Exception ex) { Console.Error.WriteLine(ex); Environment.ExitCode = 1; }
    return;
}
if (args.Length != 2 || args[0] != "--run" || !new[] { "normal", "crash-a", "crash-rt", "crash-stick", "watchdog-crash" }.Contains(args[1]))
    throw new ArgumentException("Use --run normal|crash-a|crash-rt|crash-stick|watchdog-crash");
try { await MonitorAsync(args[1]); }
catch (Exception ex) { Console.Error.WriteLine(ex); Environment.ExitCode = 1; }

static async Task WatchdogAsync(string logPath)
{
    await using var log = new StreamWriter(logPath, false) { AutoFlush = true };
    await log.WriteLineAsync($"READY qpc={Stopwatch.GetTimestamp()} pid={Environment.ProcessId}");
    Console.WriteLine($"READY {Environment.ProcessId} {Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks}");
    var arm = await Console.In.ReadLineAsync();
    if (arm is null) return;
    var parts = arm.Split(' ');
    if (parts.Length != 3 || parts[0] != "ARM") throw new InvalidDataException("INVALID_ARM");
    using var owner = VerifiedProcess(int.Parse(parts[1]), long.Parse(parts[2]));
    await log.WriteLineAsync($"ARMED qpc={Stopwatch.GetTimestamp()} owner={owner.Id}");
    Console.WriteLine("ARMED");
    using var disarmSignal = new EventWaitHandle(false, EventResetMode.ManualReset);
    string? disarmCommand = null;
    var reader = new Thread(() =>
    {
        disarmCommand = Console.ReadLine();
        if (disarmCommand is not null) disarmSignal.Set();
    }) { IsBackground = true, Name = "Watchdog disarm reader" };
    reader.Start();
    var handles = new[] { owner.SafeHandle.DangerousGetHandle(), disarmSignal.SafeWaitHandle.DangerousGetHandle() };
    var waitResult = WaitForMultipleObjects(2, handles, false, 0xFFFFFFFF);
    if (waitResult > 1) throw new InvalidOperationException($"WaitForMultipleObjects failed: {waitResult}, Win32={Marshal.GetLastPInvokeError()}");
    var disarmed = false;
    if (waitResult == 1 && WaitForSingleObject(handles[0], 0) != 0)
    {
        if (disarmCommand != "DISARM") throw new InvalidDataException("INVALID_WATCHDOG_COMMAND");
        disarmed = true;
        await log.WriteLineAsync($"DISARMED qpc={Stopwatch.GetTimestamp()}");
        Console.WriteLine("DISARMED");
        if (WaitForSingleObject(handles[0], 0xFFFFFFFF) != 0) throw new InvalidOperationException("Owner wait failed after disarm");
    }
    var detected = Stopwatch.GetTimestamp();
    await log.WriteLineAsync($"OWNER_EXIT_DETECTED qpc={detected} disarmed={disarmed}");
    if (disarmed) return;
    var start = Stopwatch.GetTimestamp();
    await log.WriteLineAsync($"RECOVERY_START qpc={start} preserveInstall=true");
    try
    {
        HMContext.RemoveAllVirtualControllers(preserveInstall: true);
        await log.WriteLineAsync($"RECOVERY_RETURN qpc={Stopwatch.GetTimestamp()} result=OK");
    }
    catch (Exception ex)
    {
        await log.WriteLineAsync($"RECOVERY_RETURN qpc={Stopwatch.GetTimestamp()} result=ERROR exception={ex}");
        Environment.ExitCode = 1;
    }
}

static void Owner(int watchdogPid, long watchdogStartTicks)
{
    using var watchdog = VerifiedProcess(watchdogPid, watchdogStartTicks);
    using var context = new HMContext();
    context.LoadDefaultProfiles();
    if (!context.IsDriverInstalled) throw new InvalidOperationException("HIDMaestro driver not installed");
    var profile = context.GetProfile("xbox-360-wired") ?? throw new InvalidOperationException("Xbox profile missing");
    Console.WriteLine($"OWNER_READY pid={Environment.ProcessId} startTicks={Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks}");
    HMController? controller = null;
    using var inputSignal = new AutoResetEvent(false);
    var commands = new ConcurrentQueue<string?>();
    var reader = new Thread(() =>
    {
        while (true)
        {
            var line = Console.ReadLine();
            commands.Enqueue(line);
            inputSignal.Set();
            if (line is null) return;
        }
    }) { IsBackground = true, Name = "Owner command reader" };
    reader.Start();
    var watchdogHandle = watchdog.SafeHandle.DangerousGetHandle();
    var waitHandles = new[] { watchdogHandle, inputSignal.SafeWaitHandle.DangerousGetHandle() };
    try
    {
        while (true)
        {
            if (WaitForSingleObject(watchdogHandle, 0) == 0)
            {
                Console.WriteLine($"WATCHDOG_LOST qpc={Stopwatch.GetTimestamp()}");
                if (controller is not null)
                {
                    Submit(controller, "neutral");
                    Console.WriteLine($"WATCHDOG_NEUTRAL qpc={Stopwatch.GetTimestamp()}");
                    controller.Dispose();
                    controller = null;
                    Console.WriteLine($"WATCHDOG_DESTROY qpc={Stopwatch.GetTimestamp()}");
                }
                return;
            }
            if (!commands.TryDequeue(out var command))
            {
                var waitResult = WaitForMultipleObjects(2, waitHandles, false, 0xFFFFFFFF);
                if (waitResult > 1) throw new InvalidOperationException($"Owner wait failed: {waitResult}, Win32={Marshal.GetLastPInvokeError()}");
                continue;
            }
            if (command is null) return;
            if (watchdog.HasExited) continue;
            if (command == "CREATE")
            {
                if (controller is not null) throw new InvalidOperationException("Already created");
                Console.WriteLine($"CREATE_ENTER qpc={Stopwatch.GetTimestamp()} identity={Identity}");
                controller = context.CreateController(profile, Identity);
                Submit(controller, "neutral");
                Console.WriteLine($"CREATED qpc={Stopwatch.GetTimestamp()}");
            }
            else if (command == "DESTROY")
            {
                if (controller is not null)
                {
                    Submit(controller, "neutral");
                    Console.WriteLine($"DESTROY_NEUTRAL qpc={Stopwatch.GetTimestamp()}");
                    controller.Dispose();
                    controller = null;
                }
                Console.WriteLine($"DESTROYED qpc={Stopwatch.GetTimestamp()}");
            }
            else if (command == "EXIT")
            {
                if (controller is not null) throw new InvalidOperationException("Cannot exit with a controller");
                Console.WriteLine($"OWNER_NORMAL_EXIT qpc={Stopwatch.GetTimestamp()}");
                return;
            }
            else if (command is "neutral" or "a" or "rt" or "stick")
            {
                if (controller is null) throw new InvalidOperationException("No controller");
                Submit(controller, command);
                Console.WriteLine($"STATE {command} qpc={Stopwatch.GetTimestamp()}");
            }
            else throw new InvalidDataException($"Unknown command {command}");
        }
    }
    finally
    {
        // Runs for normal/managed exits. Process.Kill bypasses it.
        if (controller is not null)
        {
            try { Submit(controller, "neutral"); controller.Dispose(); } catch { }
        }
    }
}

static void Submit(HMController controller, string kind)
{
    var profile = controller.Profile;
    var axes = HMGamepadStateHelpers.StandardAxes(profile);
    if (kind == "rt") axes[profile.Triggers[1].Axis] = 0.75f;
    if (kind == "stick") axes[profile.Sticks[0].XAxis] = 0.9f;
    var state = new HMGamepadState { Axes = axes, Buttons = kind == "a" ? HMButton.A : HMButton.None, Hat = HMHat.None };
    controller.SubmitState(in state);
}

static void MeasureExternalKill(int pid, long startTicks, int slot, string kind)
{
    if (!IsAdministrator() || slot is < 0 or > 3 || kind != "a") throw new InvalidOperationException("INVALID_EXTERNAL_KILL_REQUEST");
    using var target = VerifiedProcess(pid, startTicks);
    var before = Slots()[slot];
    if (!IsHeld(before, kind)) throw new InvalidOperationException($"INPUT_NOT_HELD {Describe(before)}");
    Log($"EXTERNAL_PRE_KILL pid={pid} slot={slot} state={Describe(before)}");
    var killRequested = Stopwatch.GetTimestamp();
    target.Kill(entireProcessTree: false);
    if (!target.WaitForExit(1000)) throw new InvalidOperationException("TARGET_DID_NOT_EXIT");
    var deathConfirmed = Stopwatch.GetTimestamp();
    // GetProcessById attaches to a process started elsewhere; ExitCode is unavailable.
    Log($"EXTERNAL_DEATH qpc={deathConfirmed} confirmed={target.HasExited}");
    long? safe = null;
    Pad safeState = default;
    while (Ms(Stopwatch.GetTimestamp() - killRequested) < 10000)
    {
        var state = Slots()[slot];
        var tick = Stopwatch.GetTimestamp();
        if (!state.Connected || !IsHeld(state, kind)) { safe = tick; safeState = state; break; }
        Thread.SpinWait(100);
    }
    if (safe is null) throw new InvalidOperationException($"XINPUT_STILL_HELD_AFTER_10000_MS state={Describe(Slots()[slot])}");
    var fromDeath = Ms(safe.Value - deathConfirmed);
    Log($"EXTERNAL_XINPUT_SAFE qpc={safe} from_kill_ms={Ms(safe.Value-killRequested):F4} from_death_ms={fromDeath:F4} state={Describe(safeState)}");
    if (fromDeath > 500 || Ms(safe.Value-killRequested) > 500) throw new InvalidOperationException("XINPUT_SAFE_OVER_500_MS");
    Log("EXTERNAL_TIMING_PASS");
}

static async Task MonitorAsync(string kind)
{
    if (!IsAdministrator()) throw new InvalidOperationException("Checkpoint requires an elevated monitor; nothing created");
    var before = Slots();
    Log($"BASELINE {DescribeAll(before)}");
    var pnpBefore = await PnpAsync();
    if (pnpBefore.Active.Count != 0 || before.Count(s => s.Connected) != 1 || !before[0].Connected || before[0].Active || before.Skip(1).Any(s => s.Connected))
        throw new InvalidOperationException($"Unsafe baseline: activeHM={string.Join(';', pnpBefore.Active)}");
    Log($"PNP_HISTORICAL {string.Join(';', pnpBefore.Historical)}");
    var exe = Environment.ProcessPath ?? throw new InvalidOperationException("No process path");
    var logPath = Path.Combine(Path.GetDirectoryName(exe)!, $"watchdog-{kind}-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmssfff}.log");
    Log($"WATCHDOG_LOG_PATH {logPath}");
    using var watcher = Launch(exe, $"--watchdog \"{logPath}\"");
    var watcherReady = await ReadLineAsync(watcher);
    Log($"WATCHDOG {watcherReady}");
    var watcherParts = watcherReady.Split(' ');
    if (watcherParts.Length != 3 || watcherParts[0] != "READY") throw new InvalidOperationException("Watchdog not ready");
    using var owner = Launch(exe, $"--owner {watcherParts[1]} {watcherParts[2]}");
    var ownerReady = await ReadLineAsync(owner);
    Log($"OWNER {ownerReady}");
    var ownerParts = ownerReady.Split(' ');
    if (ownerParts.Length != 3 || ownerParts[0] != "OWNER_READY") throw new InvalidOperationException("Owner not ready");
    var ownerPid = int.Parse(ownerParts[1].Split('=')[1]);
    var ownerStart = long.Parse(ownerParts[2].Split('=')[1]);
    await SendAsync(watcher, $"ARM {ownerPid} {ownerStart}");
    if (await ReadLineAsync(watcher) != "ARMED") throw new InvalidOperationException("Watchdog did not arm");
    Log("WATCHDOG_ARMED");
    await SendAsync(owner, "CREATE");
    var createEntered = await ReadLineAsync(owner);
    Log(createEntered);
    if (!createEntered.StartsWith("CREATE_ENTER")) throw new InvalidOperationException("Creation did not start");
    var created = await ReadLineAsync(owner);
    Log(created);
    if (!created.StartsWith("CREATED")) throw new InvalidOperationException("Creation did not return; stop");
    var slot = await WaitForSlotAsync(before, 5000);
    Log($"XINPUT_CREATED slot={slot} state={Describe(Slots()[slot])}");
    await WaitForAsync(() => Slots()[slot].Connected && !Slots()[slot].Active, 2000);
    Log($"INITIAL_NEUTRAL slot={slot}");

    if (kind == "normal")
    {
        foreach (var input in new[] { "a", "rt", "stick" })
        {
            await OwnerCommandAsync(owner, input);
            await WaitForAsync(() => IsHeld(Slots()[slot], input), 2000);
            Log($"HELD {input} {Describe(Slots()[slot])}");
            await OwnerCommandAsync(owner, "neutral");
            await WaitForAsync(() => Slots()[slot].Connected && !Slots()[slot].Active, 2000);
            Log($"RELEASED {input} {Describe(Slots()[slot])}");
        }
        await OwnerCommandAsync(owner, "neutral");
        await WaitForAsync(() => Slots()[slot].Connected && !Slots()[slot].Active, 2000);
        Log($"EXPLICIT_NEUTRAL {Describe(Slots()[slot])}");
        await OwnerCommandAsync(owner, "DESTROY");
        await WaitForAsync(() => !Slots()[slot].Connected, 5000);
        Log("XINPUT_DESTROYED_BY_OWNER");
        await SendAsync(watcher, "DISARM");
        if (await ReadLineAsync(watcher) != "DISARMED") throw new InvalidOperationException("Disarm failed");
        Log("WATCHDOG_DISARMED_AFTER_DESTROY");
        await OwnerCommandAsync(owner, "EXIT");
        if (!owner.WaitForExit(5000) || owner.ExitCode != 0) throw new InvalidOperationException("Owner normal exit failed");
        if (!watcher.WaitForExit(5000) || watcher.ExitCode != 0) throw new InvalidOperationException("Watchdog normal exit failed");
        Log($"NORMAL_EXITS owner={owner.ExitCode} watchdog={watcher.ExitCode}");
        if (File.Exists(logPath)) foreach (var line in await File.ReadAllLinesAsync(logPath)) Log($"WATCHDOG_LOG {line}");
        var after = await PnpAsync();
        Log($"NORMAL_PNP_ACTIVE {string.Join(';', after.Active)}");
        Log($"NORMAL_PNP_NEW_HISTORICAL {string.Join(';', after.Historical.Except(pnpBefore.Historical))}");
        if (after.Active.Count != 0) throw new InvalidOperationException("PnP active after normal destroy");
        Log("NORMAL_PASS");
        return;
    }

    if (kind == "watchdog-crash")
        await OwnerCommandAsync(owner, "a");
    else
        await OwnerCommandAsync(owner, kind[6..]);
    var heldKind = kind == "watchdog-crash" ? "a" : kind[6..];
    await WaitForAsync(() => IsHeld(Slots()[slot], heldKind), 2000);
    Log($"PRE_KILL {heldKind} {Describe(Slots()[slot])}");
    var killTarget = kind == "watchdog-crash" ? watcher : owner;
    var killRequested = Stopwatch.GetTimestamp();
    Log($"KILL_REQUEST qpc={killRequested} pid={killTarget.Id}");
    killTarget.Kill(entireProcessTree: false);
    if (!killTarget.WaitForExit(1000)) throw new InvalidOperationException("Kill target did not exit");
    var deathConfirmed = Stopwatch.GetTimestamp();
    Log($"DEATH_CONFIRMED qpc={deathConfirmed} exit={killTarget.ExitCode}");
    var lastHeld = deathConfirmed;
    long? safeTick = null;
    Pad safeState = default;
    while (Ms(Stopwatch.GetTimestamp() - killRequested) < 10000)
    {
        var state = Slots()[slot];
        var tick = Stopwatch.GetTimestamp();
        if (!state.Connected || !IsHeld(state, heldKind)) { safeTick = tick; safeState = state; break; }
        lastHeld = tick;
        Thread.SpinWait(100);
    }
    if (safeTick is null)
    {
        Log($"FAIL_HELD_AFTER_KILL last_held_from_death_ms={Ms(lastHeld - deathConfirmed):F3} state={Describe(Slots()[slot])}");
        throw new InvalidOperationException("Input held beyond 10000 ms; no further recovery attempts");
    }
    Log($"XINPUT_SAFE qpc={safeTick} from_kill_ms={Ms(safeTick.Value-killRequested):F3} from_death_ms={Ms(safeTick.Value-deathConfirmed):F3} state={Describe(safeState)}");
    if (kind == "watchdog-crash")
    {
        if (!owner.WaitForExit(5000)) Log($"OWNER_STILL_ALIVE pid={owner.Id}");
        Log($"OWNER_EXIT={(owner.HasExited ? owner.ExitCode.ToString() : "NONE")}");
        if (owner.HasExited) Log($"OWNER_FINAL_LOG {await owner.StandardOutput.ReadToEndAsync()}");
    }
    else
    {
        if (!watcher.WaitForExit(30000)) throw new InvalidOperationException($"Watchdog did not finish recovery within 30000 ms, pid={watcher.Id}");
        Log($"WATCHDOG_EXIT={watcher.ExitCode}");
        var watchdogLines = await File.ReadAllLinesAsync(logPath);
        foreach (var line in watchdogLines) Log($"WATCHDOG_LOG {line}");
        long EventTick(string prefix) => long.Parse(watchdogLines.Single(line => line.StartsWith(prefix, StringComparison.Ordinal)).Split("qpc=")[1].Split(' ')[0]);
        var detectTick = EventTick("OWNER_EXIT_DETECTED ");
        var recoveryStartTick = EventTick("RECOVERY_START ");
        var recoveryReturnTick = EventTick("RECOVERY_RETURN ");
        if (!watchdogLines.Any(line => line.StartsWith("RECOVERY_RETURN ") && line.Contains("result=OK")))
            throw new InvalidOperationException("Recovery did not report OK");
        Log($"TIMINGS_MS death_to_detect={Ms(detectTick-deathConfirmed):F4} detect_to_recovery={Ms(recoveryStartTick-detectTick):F4} recovery_to_xinput_safe={Ms(safeTick.Value-recoveryStartTick):F4} death_to_xinput_safe={Ms(safeTick.Value-deathConfirmed):F4} recovery_duration={Ms(recoveryReturnTick-recoveryStartTick):F4}");
    }
    var pnpAfter = await PnpAsync();
    Log($"PNP_AFTER active={string.Join(';', pnpAfter.Active)} newHistorical={string.Join(';', pnpAfter.Historical.Except(pnpBefore.Historical))} queryAtMs={Ms(Stopwatch.GetTimestamp()-killRequested):F3}");
    var totalMs = Ms(safeTick.Value - killRequested); // conservative bound, before confirmed death
    if (totalMs > 500 || pnpAfter.Active.Count != 0 || (kind == "watchdog-crash" && (!owner.HasExited || owner.ExitCode != 0)) || (kind != "watchdog-crash" && watcher.ExitCode != 0))
        throw new InvalidOperationException($"Checkpoint failed: XInput safe after {totalMs:F3}ms or recovery/PnP error");
    Log($"PASS {kind}");
}

static Process Launch(string exe, string args)
{
    var process = new Process { StartInfo = new ProcessStartInfo(exe, args) { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true } };
    if (!process.Start()) throw new InvalidOperationException($"Failed to start {args}");
    return process;
}
static async Task<string> ReadLineAsync(Process p)
{
    var line = await p.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(20));
    if (line is null) throw new InvalidOperationException($"Process {p.Id} ended early, exit={p.ExitCode}, stderr={await p.StandardError.ReadToEndAsync()}");
    return line;
}
static async Task SendAsync(Process p, string command) { await p.StandardInput.WriteLineAsync(command); await p.StandardInput.FlushAsync(); }
static async Task OwnerCommandAsync(Process p, string command)
{
    await SendAsync(p, command);
    var response = await ReadLineAsync(p);
    Log($"OWNER_RESPONSE {response}");
    if (response.StartsWith("DESTROY_NEUTRAL "))
    {
        response = await ReadLineAsync(p);
        Log($"OWNER_RESPONSE {response}");
    }
    if (!(response.StartsWith("STATE ") || response.StartsWith("DESTROYED ") || response.StartsWith("OWNER_NORMAL_EXIT "))) throw new InvalidOperationException($"Unexpected owner response {response}");
}
static Process VerifiedProcess(int pid, long expectedStartTicks)
{
    var p = Process.GetProcessById(pid);
    if (p.StartTime.ToUniversalTime().Ticks != expectedStartTicks) { p.Dispose(); throw new InvalidOperationException("Process identity mismatch"); }
    return p;
}
static async Task WaitForAsync(Func<bool> predicate, double milliseconds)
{
    var start = Stopwatch.GetTimestamp();
    while (Ms(Stopwatch.GetTimestamp() - start) < milliseconds)
    {
        if (predicate()) return;
        await Task.Delay(10);
    }
    throw new TimeoutException("Condition not reached");
}
static async Task<int> WaitForSlotAsync(Pad[] before, double milliseconds)
{
    var slot = -1;
    await WaitForAsync(() =>
    {
        var now = Slots();
        var created = Enumerable.Range(0, 4).Where(i => now[i].Connected && !before[i].Connected).ToArray();
        if (created.Length != 1) return false;
        slot = created[0]; return true;
    }, milliseconds);
    return slot;
}
static bool IsHeld(Pad s, string kind) => s.Connected && kind switch
{
    "a" => (s.Buttons & 0x1000) != 0,
    "rt" => s.RightTrigger >= 180,
    "stick" => s.LeftX > 20000,
    _ => throw new ArgumentException(kind)
};
static string Describe(Pad s) => $"connected={s.Connected},buttons={s.Buttons},lt={s.LeftTrigger},rt={s.RightTrigger},lx={s.LeftX},ly={s.LeftY},rx={s.RightX},ry={s.RightY}";
static string DescribeAll(Pad[] values) => string.Join(';', values.Select((v,i) => $"{i}:{Describe(v)}"));
static void Log(string s) { Console.WriteLine($"{DateTimeOffset.Now:O} qpc={Stopwatch.GetTimestamp()} {s}"); Console.Out.Flush(); }
static double Ms(long ticks) => 1000.0 * ticks / Stopwatch.Frequency;
static Pad[] Slots() => Enumerable.Range(0,4).Select(i =>
{
    var result = XInputGetState((uint)i, out var state);
    var s = state.Gamepad;
    return result == 0 ? new Pad(true, s.Buttons, s.LeftTrigger, s.RightTrigger, s.LeftX, s.LeftY, s.RightX, s.RightY) : default;
}).ToArray();
static async Task<(HashSet<string> Active, HashSet<string> Historical)> PnpAsync()
{
    static async Task<HashSet<string>> Query(string scope)
    {
        using var p = Process.Start(new ProcessStartInfo("pnputil.exe", $"/enum-devices /{scope}") { UseShellExecute=false, RedirectStandardOutput=true, RedirectStandardError=true, CreateNoWindow=true }) ?? throw new InvalidOperationException("PnP query launch failed");
        var output = await p.StandardOutput.ReadToEndAsync();
        await p.WaitForExitAsync();
        if (p.ExitCode != 0) throw new InvalidOperationException($"PnP query failed: {scope}");
        return output.Split('\n').Select(x => x.Trim()).Where(x => x.StartsWith("Id. de instancia:") || x.StartsWith("Instance ID:")).Select(x => x[(x.IndexOf(':')+1)..].Trim()).Where(x => x.Contains("HIDMAESTRO", StringComparison.OrdinalIgnoreCase) || x.Contains("HM_", StringComparison.OrdinalIgnoreCase)).ToHashSet(StringComparer.OrdinalIgnoreCase);
    }
    return (await Query("connected"), await Query("disconnected"));
}
static bool IsAdministrator()
{
    using var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
    return new System.Security.Principal.WindowsPrincipal(identity).IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
}
[DllImport("xinput1_4.dll", EntryPoint="XInputGetState")]
static extern uint XInputGetState(uint index, out XState state);
[DllImport("kernel32.dll", SetLastError=true)]
static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, [MarshalAs(UnmanagedType.Bool)] bool waitAll, uint milliseconds);
[DllImport("kernel32.dll", SetLastError=true)]
static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
[StructLayout(LayoutKind.Sequential)]
struct XState { public uint Packet; public XGamepad Gamepad; }
[StructLayout(LayoutKind.Sequential)]
struct XGamepad { public ushort Buttons; public byte LeftTrigger, RightTrigger; public short LeftX, LeftY, RightX, RightY; }
record struct Pad(bool Connected, ushort Buttons, byte LeftTrigger, byte RightTrigger, short LeftX, short LeftY, short RightX, short RightY)
{
    // XInput reports an axis one unit away from zero for some neutral devices.
    public bool Active => Buttons != 0 || LeftTrigger != 0 || RightTrigger != 0 || Math.Abs((int)LeftX) > 1 || Math.Abs((int)LeftY) > 1 || Math.Abs((int)RightX) > 1 || Math.Abs((int)RightY) > 1;
}

using System.Diagnostics;
using System.Runtime.InteropServices;
using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.Xbox360;

// Standalone manual checkpoint. Never load this project from the JoyLinkea runtime.
if (args.Length == 1 && args[0] == "--feeder")
{
    using var client = new ViGEmClient();
    var pad = client.CreateXbox360Controller();
    pad.AutoSubmitReport = false;
    pad.Connect();
    pad.ResetReport();
    pad.SubmitReport();
    Console.WriteLine($"READY pid={Environment.ProcessId} qpc={Stopwatch.GetTimestamp()}");
    while (Console.ReadLine() is { } command)
    {
        if (command == "destroy")
        {
            pad.ResetReport();
            pad.SubmitReport();
            pad.Disconnect();
            Console.WriteLine($"DESTROYED qpc={Stopwatch.GetTimestamp()}");
            return;
        }
        pad.ResetReport();
        switch (command)
        {
            case "neutral": break;
            case "a": pad.SetButtonState(Xbox360Button.A, true); break;
            case "rt": pad.SetSliderValue(Xbox360Slider.RightTrigger, 170); break;
            case "stick": pad.SetAxisValue(Xbox360Axis.LeftThumbX, 22000); break;
            default: throw new ArgumentException($"Unknown command: {command}");
        }
        pad.SubmitReport();
        Console.WriteLine($"STATE {command} qpc={Stopwatch.GetTimestamp()}");
    }
    // EOF is a normal exit, not used to simulate a crash.
    pad.ResetReport();
    pad.SubmitReport();
    pad.Disconnect();
    return;
}

if (args.Length != 1 || !new[] { "normal", "crash-a", "crash-rt", "crash-stick" }.Contains(args[0]))
    throw new ArgumentException("Use normal or crash-a/crash-rt/crash-stick");

var mode = args[0];
var baseline = Snapshot();
Log($"BASELINE {DescribeAll(baseline)}");
var baselinePnp = await PnpAsync();
Log($"BASELINE_PNP_CONNECTED {string.Join(';', baselinePnp.Connected)}");
Log($"BASELINE_PNP_DISCONNECTED {string.Join(';', baselinePnp.Disconnected)}");
if (baseline.Count(s => s.Connected) != 1 || !baseline[0].Connected || baseline[0].Active || baseline.Skip(1).Any(s => s.Connected))
    throw new InvalidOperationException("Baseline XInput differs from authorized phase 0; no feeder started.");

var exe = Environment.ProcessPath ?? throw new InvalidOperationException("No executable path");
using var feeder = new Process
{
    StartInfo = new ProcessStartInfo(exe, "--feeder")
    {
        UseShellExecute = false,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true
    }
};
if (!feeder.Start()) throw new InvalidOperationException("Feeder start failed");
Log($"FEEDER_START pid={feeder.Id}");
var cleanlyDestroyed = false;
try
{
    var ready = await ReadLineAsync(feeder, TimeSpan.FromSeconds(15));
    Log(ready);
    if (!ready.StartsWith("READY ")) throw new InvalidOperationException("Feeder did not become ready");
    var slot = await WaitForNewSlotAsync(baseline, TimeSpan.FromSeconds(5));
    Log($"CREATED slot={slot} state={Describe(Snapshot()[slot])}");
    RequireNeutral(Snapshot()[slot]);

    if (mode == "normal")
    {
        foreach (var kind in new[] { "a", "rt", "stick" })
        {
            await CommandAsync(feeder, kind);
            await WaitForAsync(() => IsHeld(Snapshot()[slot], kind), TimeSpan.FromSeconds(2));
            Log($"HELD {kind} slot={slot} state={Describe(Snapshot()[slot])}");
            await CommandAsync(feeder, "neutral");
            await WaitForAsync(() => Snapshot()[slot].Connected && !Snapshot()[slot].Active, TimeSpan.FromSeconds(2));
            Log($"RELEASED {kind} slot={slot} state={Describe(Snapshot()[slot])}");
        }
        await CommandAsync(feeder, "neutral");
        RequireNeutral(Snapshot()[slot]);
        await CommandAsync(feeder, "destroy");
        if (!feeder.WaitForExit(5000) || feeder.ExitCode != 0) throw new InvalidOperationException("Normal feeder exit failed");
        cleanlyDestroyed = true;
        await WaitForAsync(() => !Snapshot()[slot].Connected, TimeSpan.FromSeconds(5));
        Log($"NORMAL_XINPUT_REMOVED slot={slot}");
        var after = await PnpAsync();
        Log($"NORMAL_PNP_NEW_CONNECTED {string.Join(';', after.Connected.Except(baselinePnp.Connected))}");
        Log($"NORMAL_PNP_NEW_DISCONNECTED {string.Join(';', after.Disconnected.Except(baselinePnp.Disconnected))}");
        if (after.Connected.Except(baselinePnp.Connected).Any()) throw new InvalidOperationException("New connected PnP device after normal destroy");
        Log("NORMAL_PASS");
    }
    else
    {
        var kind = mode[6..];
        await CommandAsync(feeder, kind);
        await WaitForAsync(() => IsHeld(Snapshot()[slot], kind), TimeSpan.FromSeconds(2));
        Log($"PRE_KILL {kind} slot={slot} state={Describe(Snapshot()[slot])}");
        var t0 = Stopwatch.GetTimestamp();
        Log($"KILL_CALL kind={kind} pid={feeder.Id} qpc={t0}");
        feeder.Kill(entireProcessTree: false);
        long? neutralTick = null;
        string? neutralState = null;
        var lastHeld = t0;
        while (Ms(Stopwatch.GetTimestamp() - t0) <= 1500)
        {
            var state = Snapshot()[slot];
            var tick = Stopwatch.GetTimestamp();
            if (!IsHeld(state, kind))
            {
                neutralTick = tick;
                neutralState = Describe(state);
                break;
            }
            lastHeld = tick;
            Thread.SpinWait(150);
        }
        Log($"FEEDER_EXITED={feeder.WaitForExit(1000)} EXIT_CODE={(feeder.HasExited ? feeder.ExitCode : -999)}");
        if (neutralTick is null)
        {
            Log($"CRASH_FAIL kind={kind} still_held_after_ms={Ms(lastHeld - t0):F3} state={Describe(Snapshot()[slot])}");
            throw new InvalidOperationException("Input remained held after crash");
        }
        var elapsed = Ms(neutralTick.Value - t0);
        Log($"XINPUT_NEUTRAL_OR_DISCONNECTED kind={kind} elapsed_ms={elapsed:F3} state={neutralState}");
        var pnpStart = Stopwatch.GetTimestamp();
        var pnp = await PnpAsync();
        var pnpGone = !pnp.Connected.Except(baselinePnp.Connected).Any();
        Log($"PNP_AFTER_KILL elapsed_ms={Ms(Stopwatch.GetTimestamp() - t0):F3} new_connected={string.Join(';', pnp.Connected.Except(baselinePnp.Connected))} new_disconnected={string.Join(';', pnp.Disconnected.Except(baselinePnp.Disconnected))}");
        Log($"PNP_QUERY_DURATION_MS={Ms(Stopwatch.GetTimestamp() - pnpStart):F3}");
        if (elapsed > 500 || !pnpGone || Snapshot()[slot].Connected)
            throw new InvalidOperationException($"Crash criterion failed: elapsed={elapsed:F3}ms, pnpGone={pnpGone}");
        Log($"CRASH_PASS kind={kind}");
    }
}
finally
{
    if (!feeder.HasExited && mode == "normal")
    {
        try { await CommandAsync(feeder, "neutral"); await CommandAsync(feeder, "destroy"); cleanlyDestroyed = true; } catch { }
    }
    if (!feeder.HasExited && !cleanlyDestroyed)
        Log($"FEEDER_REMAINS_RUNNING pid={feeder.Id}; no automatic forced cleanup");
}

static void Log(string message) => Console.WriteLine($"{DateTimeOffset.Now:O} qpc={Stopwatch.GetTimestamp()} {message}");
static double Ms(long ticks) => ticks * 1000.0 / Stopwatch.Frequency;
static async Task<string> ReadLineAsync(Process process, TimeSpan timeout)
{
    var line = await process.StandardOutput.ReadLineAsync().WaitAsync(timeout);
    if (line is null) throw new InvalidOperationException($"Feeder exited before reply: {await process.StandardError.ReadToEndAsync()}");
    return line;
}
static async Task CommandAsync(Process process, string command)
{
    await process.StandardInput.WriteLineAsync(command);
    await process.StandardInput.FlushAsync();
    var response = await ReadLineAsync(process, TimeSpan.FromSeconds(5));
    if (!(response.StartsWith("STATE ") || response.StartsWith("DESTROYED ")))
        throw new InvalidOperationException($"Unexpected feeder response: {response}");
    Log($"COMMAND {command} ACK {response}");
}
static async Task WaitForAsync(Func<bool> condition, TimeSpan timeout)
{
    var start = Stopwatch.GetTimestamp();
    while (Ms(Stopwatch.GetTimestamp() - start) < timeout.TotalMilliseconds)
    {
        if (condition()) return;
        await Task.Delay(5);
    }
    throw new TimeoutException("Condition not reached");
}
static async Task<int> WaitForNewSlotAsync(Pad[] baseline, TimeSpan timeout)
{
    int result = -1;
    await WaitForAsync(() =>
    {
        var states = Snapshot();
        var found = Enumerable.Range(0, 4).Where(i => states[i].Connected && !baseline[i].Connected).ToArray();
        if (found.Length != 1) return false;
        result = found[0];
        return true;
    }, timeout);
    return result;
}
static void RequireNeutral(Pad state)
{
    if (!state.Connected || state.Active) throw new InvalidOperationException($"Expected connected neutral, got {Describe(state)}");
}
static bool IsHeld(Pad state, string kind) => state.Connected && kind switch
{
    "a" => (state.Buttons & 0x1000) != 0,
    "rt" => state.RightTrigger == 170,
    "stick" => state.LeftX == 22000,
    _ => throw new ArgumentException(kind)
};
static string Describe(Pad state) => $"connected={state.Connected},buttons={state.Buttons},lt={state.LeftTrigger},rt={state.RightTrigger},lx={state.LeftX},ly={state.LeftY},rx={state.RightX},ry={state.RightY}";
static string DescribeAll(Pad[] states) => string.Join(";", states.Select((s, i) => $"{i}:{Describe(s)}"));
static Pad[] Snapshot() => Enumerable.Range(0, 4).Select(i =>
{
    var result = XInputGetState((uint)i, out var state);
    return result == 0 ? new Pad(true, state.Gamepad.Buttons, state.Gamepad.LeftTrigger, state.Gamepad.RightTrigger, state.Gamepad.LeftX, state.Gamepad.LeftY, state.Gamepad.RightX, state.Gamepad.RightY) : new Pad(false, 0, 0, 0, 0, 0, 0, 0);
}).ToArray();
static async Task<(HashSet<string> Connected, HashSet<string> Disconnected)> PnpAsync()
{
    static async Task<HashSet<string>> Query(string scope)
    {
        using var process = Process.Start(new ProcessStartInfo("pnputil", $"/enum-devices /{scope}") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true }) ?? throw new InvalidOperationException("pnputil start failed");
        var output = await process.StandardOutput.ReadToEndAsync();
        await process.WaitForExitAsync();
        if (process.ExitCode != 0) throw new InvalidOperationException($"pnputil {scope} exit={process.ExitCode}");
        return output.Split('\n').Select(s => s.Trim()).Where(s => s.Contains("\\") && (s.StartsWith("Id. de instancia:") || s.StartsWith("Instance ID:"))).Select(s => s[(s.IndexOf(':') + 1)..].Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
    }
    return (await Query("connected"), await Query("disconnected"));
}

[DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")]
static extern uint XInputGetState(uint index, out XInputState state);
[StructLayout(LayoutKind.Sequential)]
struct XInputState { public uint Packet; public XInputGamepad Gamepad; }
[StructLayout(LayoutKind.Sequential)]
struct XInputGamepad { public ushort Buttons; public byte LeftTrigger; public byte RightTrigger; public short LeftX; public short LeftY; public short RightX; public short RightY; }
record struct Pad(bool Connected, ushort Buttons, byte LeftTrigger, byte RightTrigger, short LeftX, short LeftY, short RightX, short RightY)
{
    public bool Active => Buttons != 0 || LeftTrigger != 0 || RightTrigger != 0 || LeftX != 0 || LeftY != 0 || RightX != 0 || RightY != 0;
}

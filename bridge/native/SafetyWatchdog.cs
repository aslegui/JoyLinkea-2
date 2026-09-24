using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using HIDMaestro;

internal static class SafetyWatchdog
{
    internal static int Run(int ownerPid, long ownerStartTicks)
    {
        using var owner = Process.GetProcessById(ownerPid);
        if (owner.StartTime.ToUniversalTime().Ticks != ownerStartTicks)
            throw new InvalidOperationException("OWNER_IDENTITY_MISMATCH");
        var logDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JoyLinkea-2", "logs");
        Directory.CreateDirectory(logDirectory);
        var logPath = Path.Combine(logDirectory, $"safety-watchdog-{DateTime.UtcNow:yyyyMMdd-HHmmssfff}-{Environment.ProcessId}.log");
        using var log = new StreamWriter(new FileStream(logPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) { AutoFlush = true };
        void Record(string message) => log.WriteLine($"qpc={Stopwatch.GetTimestamp()} {message}");
        using var disarmEvent = new EventWaitHandle(false, EventResetMode.ManualReset);
        string? command = null;
        var commandReader = new Thread(() =>
        {
            command = Console.ReadLine();
            if (command is not null) disarmEvent.Set();
        }) { IsBackground = true, Name = "Safety disarm reader" };
        commandReader.Start();
        Record($"ARMED ownerPid={ownerPid} ownerStartTicks={ownerStartTicks}");
        Console.WriteLine($"ARMED {logPath}");
        var ownerHandle = owner.SafeHandle.DangerousGetHandle();
        var handles = new[] { ownerHandle, disarmEvent.SafeWaitHandle.DangerousGetHandle() };
        var result = WaitForMultipleObjects(2, handles, false, uint.MaxValue);
        if (result > 1) throw new InvalidOperationException($"OWNER_WAIT_FAILED {result} {Marshal.GetLastPInvokeError()}");
        if (result == 1 && WaitForSingleObject(ownerHandle, 0) != 0)
        {
            if (command != "DISARM") throw new InvalidDataException("INVALID_SAFETY_COMMAND");
            Record("DISARMED_AFTER_OWNER_CLEANUP");
            Console.WriteLine("DISARMED");
            if (WaitForSingleObject(ownerHandle, uint.MaxValue) != 0) throw new InvalidOperationException("OWNER_WAIT_AFTER_DISARM_FAILED");
            Record("OWNER_EXIT_AFTER_DISARM");
            return 0;
        }
        Record("OWNER_EXIT_DETECTED");
        try
        {
            Record("RECOVERY_START preserveInstall=true");
            HMContext.RemoveAllVirtualControllers(preserveInstall: true);
            Record("RECOVERY_RETURN OK");
            return 0;
        }
        catch (Exception error)
        {
            Record($"RECOVERY_RETURN ERROR {error}");
            return 1;
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, [MarshalAs(UnmanagedType.Bool)] bool waitAll, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
}

internal sealed class SafetySession : IDisposable
{
    private readonly Process watchdog;
    private readonly string logPath;
    private volatile bool disarmed;
    private volatile bool lost;

    private SafetySession(Process watchdog, string logPath) { this.watchdog = watchdog; this.logPath = logPath; }
    public bool IsHealthy => !lost && !watchdog.HasExited;
    public string LogPath => logPath;
    public int ProcessId => watchdog.Id;
    public long ProcessStartTicks => watchdog.StartTime.ToUniversalTime().Ticks;

    public static SafetySession Start()
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("PROCESS_PATH_MISSING");
        var info = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        if (Path.GetFileName(executable).Equals("dotnet.exe", StringComparison.OrdinalIgnoreCase))
            info.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        using var owner = Process.GetCurrentProcess();
        info.ArgumentList.Add("--safety-watchdog");
        info.ArgumentList.Add(owner.Id.ToString());
        info.ArgumentList.Add(owner.StartTime.ToUniversalTime().Ticks.ToString());
        var child = Process.Start(info) ?? throw new InvalidOperationException("SAFETY_WATCHDOG_START_FAILED");
        try
        {
            var ready = child.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
            if (ready is null || !ready.StartsWith("ARMED ", StringComparison.Ordinal)) throw new InvalidOperationException("SAFETY_WATCHDOG_NOT_ARMED");
            return new SafetySession(child, ready[6..]);
        }
        catch { child.Dispose(); throw; }
    }

    public void Monitor(NativeBridge bridge)
    {
        var monitor = new Thread(() =>
        {
            var result = SafetyWatchdog.WaitForSingleObject(watchdog.SafeHandle.DangerousGetHandle(), uint.MaxValue);
            if (disarmed) return;
            lost = true;
            try { bridge.Dispose(); } catch { }
            Environment.Exit(result == 0 ? 2 : 3);
        }) { IsBackground = true, Name = "Safety Watchdog process monitor" };
        monitor.Start();
    }

    public void Disarm()
    {
        if (disarmed) return;
        if (watchdog.HasExited) throw new InvalidOperationException("SAFETY_WATCHDOG_LOST");
        watchdog.StandardInput.WriteLine("DISARM");
        watchdog.StandardInput.Flush();
        var response = watchdog.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
        if (response != "DISARMED") throw new InvalidOperationException("SAFETY_DISARM_NOT_ACKNOWLEDGED");
        disarmed = true;
    }

    public void Dispose() => watchdog.Dispose();
}

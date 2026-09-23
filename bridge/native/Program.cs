using System.Text.Json;
using HIDMaestro;

// Native Bridge candidate. --self-test never creates a Windows device.
if (args.Length == 2 && args[0] == "--checkpoint-one")
{
    using var log = new StreamWriter(args[1]) { AutoFlush = true };
    await NativeCheckpoint.OneAsync(log);
    return;
}
if (args.Length == 1 && args[0] == "--self-test")
{
    var parsed = PadState.Parse(JsonDocument.Parse("""{"leftStick":{"x":1,"y":-1},"rightStick":{"x":0,"y":0},"lt":0.5,"rt":1,"buttons":{"a":true,"b":false,"x":false,"y":false,"lb":false,"rb":false,"l3":false,"r3":false,"back":false,"start":false},"dpad":{"up":true,"down":false,"left":false,"right":true}}""").RootElement);
    if (parsed.LeftX != 1 || parsed.LeftY != -1 || parsed.RightTrigger != 1 || !parsed.A || !parsed.Up || !parsed.Right) throw new Exception("SELF_TEST_FAILED");
    using var context = new HMContext();
    context.LoadDefaultProfiles();
    var profile = context.GetProfile("xbox-360-wired") ?? throw new Exception("PROFILE_MISSING");
    var mapped = NativeBridge.Map(parsed, profile);
    if ((mapped.Buttons & HMButton.A) == 0 || mapped.Hat != HMHat.NorthEast || mapped.Axes == null || mapped.Axes[profile.Sticks[0].XAxis] != 1 || mapped.Axes[profile.Triggers[1].Axis] != 1) throw new Exception("MAPPING_FAILED");
    Console.WriteLine("SELF_TEST_OK");
    return;
}
if (args.Length == 1 && args[0] == "--install")
{
    using var installContext = new HMContext();
    installContext.InstallDriver();
    Console.WriteLine("DRIVER_INSTALL_COMPLETE");
    return;
}
if (args.Length != 1 || args[0] != "--run")
{
    Console.Error.WriteLine("Uso: JoyLinkBridge --self-test | --install | --run");
    Environment.ExitCode = 2;
    return;
}

using var bridge = new NativeBridge();
await bridge.RunAsync();

internal sealed record PadState(
    double LeftX, double LeftY, double RightX, double RightY,
    double LeftTrigger, double RightTrigger,
    bool A, bool B, bool X, bool Y, bool LB, bool RB, bool L3, bool R3, bool Back, bool Start,
    bool Up, bool Down, bool Left, bool Right)
{
    public static PadState Parse(JsonElement root)
    {
        RequireObject(root, "leftStick", "rightStick", "lt", "rt", "buttons", "dpad");
        var ls = root.GetProperty("leftStick"); var rs = root.GetProperty("rightStick");
        RequireObject(ls, "x", "y"); RequireObject(rs, "x", "y");
        var buttons = root.GetProperty("buttons");
        RequireObject(buttons, "a", "b", "x", "y", "lb", "rb", "l3", "r3", "back", "start");
        var dpad = root.GetProperty("dpad");
        RequireObject(dpad, "up", "down", "left", "right");
        return new PadState(
            Number(ls, "x", -1, 1), Number(ls, "y", -1, 1),
            Number(rs, "x", -1, 1), Number(rs, "y", -1, 1),
            Number(root, "lt", 0, 1), Number(root, "rt", 0, 1),
            Flag(buttons, "a"), Flag(buttons, "b"), Flag(buttons, "x"), Flag(buttons, "y"),
            Flag(buttons, "lb"), Flag(buttons, "rb"), Flag(buttons, "l3"), Flag(buttons, "r3"),
            Flag(buttons, "back"), Flag(buttons, "start"),
            Flag(dpad, "up"), Flag(dpad, "down"), Flag(dpad, "left"), Flag(dpad, "right"));
    }
    private static void RequireObject(JsonElement value, params string[] names)
    {
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != names.Length || names.Any(n => !value.TryGetProperty(n, out _))) throw new InvalidDataException("INVALID_STATE_SCHEMA");
    }
    private static double Number(JsonElement value, string name, double min, double max)
    {
        var x = value.GetProperty(name);
        if (x.ValueKind != JsonValueKind.Number || !x.TryGetDouble(out var n) || !double.IsFinite(n) || n < min || n > max) throw new InvalidDataException("INVALID_STATE_RANGE");
        return n;
    }
    private static bool Flag(JsonElement value, string name)
    {
        var x = value.GetProperty(name);
        if (x.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new InvalidDataException("INVALID_STATE_BUTTON");
        return x.GetBoolean();
    }
}

internal sealed class NativeBridge : IDisposable
{
    private readonly HMContext context = new();
    private readonly Dictionary<int, HMController> controllers = new();
    private readonly Dictionary<int, PadState> states = new();
    private readonly object gate = new();
    private readonly Timer watchdog;
    private long lastPing = Environment.TickCount64;
    private bool disposed;
    private static readonly PadState Neutral = new(0,0,0,0,0,0,false,false,false,false,false,false,false,false,false,false,false,false,false,false);

    public NativeBridge()
    {
        context.LoadDefaultProfiles();
        var timeout = int.TryParse(Environment.GetEnvironmentVariable("JOYLINKEA_BRIDGE_WATCHDOG_MS"), out var configured) && configured > 0 ? configured : 3000;
        watchdog = new Timer(_ => { if (Environment.TickCount64 - Interlocked.Read(ref lastPing) > timeout) { Dispose(); Environment.Exit(1); } }, null, 250, 250);
    }
    public async Task RunAsync()
    {
        try
        {
            string? line;
            while ((line = await Console.In.ReadLineAsync()) != null)
            {
                long id = -1;
                try
                {
                    if (System.Text.Encoding.UTF8.GetByteCount(line) > 8192) throw new InvalidDataException("TOO_LARGE");
                    using var doc = JsonDocument.Parse(line);
                    var cmd = doc.RootElement;
                    id = cmd.GetProperty("id").GetInt64();
                    if (id < 0 || cmd.GetProperty("version").GetInt32() != 1) throw new InvalidDataException("INVALID_COMMAND");
                    var type = cmd.GetProperty("type").GetString();
                    object? extra = null;
                    lock (gate)
                    {
                        switch (type)
                        {
                            case "PING": Interlocked.Exchange(ref lastPing, Environment.TickCount64); extra = new { type = "PONG" }; break;
                            case "CREATE_CONTROLLER": Create(Slot(cmd)); break;
                            case "SET_STATE": Set(Slot(cmd), PadState.Parse(cmd.GetProperty("state"))); break;
                            case "NEUTRALIZE": Neutralize(Slot(cmd)); break;
                            case "DESTROY_CONTROLLER": Destroy(Slot(cmd)); break;
                            case "NEUTRALIZE_ALL": NeutralizeAll(); break;
                            case "STATUS": extra = new { controllers = states.Select(kv => new { id = kv.Key, state = kv.Value }).ToArray() }; break;
                            case "SHUTDOWN": NeutralizeAll(); foreach (var slot in controllers.Keys.ToArray()) Destroy(slot); Write(id, true); return;
                            default: throw new InvalidDataException("UNKNOWN_COMMAND");
                        }
                    }
                    Write(id, true, extra);
                }
                catch (Exception error) { Write(id, false, error: error is InvalidDataException ? error.Message : "BACKEND_ERROR"); }
            }
        }
        finally { Dispose(); }
    }
    private static int Slot(JsonElement cmd)
    {
        var slot = cmd.GetProperty("controllerId").GetInt32();
        if (slot is < 1 or > 4) throw new InvalidDataException("INVALID_CONTROLLER");
        return slot;
    }
    private void Create(int slot)
    {
        if (controllers.ContainsKey(slot)) throw new InvalidDataException("CONTROLLER_EXISTS");
        var profile = context.GetProfile("xbox-360-wired") ?? throw new InvalidOperationException("PROFILE_MISSING");
        var ctrl = context.CreateController(profile, $"joylinkea2-slot-{slot}");
        controllers[slot] = ctrl;
        try { Set(slot, Neutral); }
        catch { controllers.Remove(slot); ctrl.Dispose(); throw; }
    }
    private void Set(int slot, PadState s)
    {
        if (!controllers.TryGetValue(slot, out var ctrl)) throw new InvalidDataException("CONTROLLER_NOT_FOUND");
        var state = Map(s, ctrl.Profile);
        ctrl.SubmitState(in state);
        states[slot] = s;
    }
    public static HMGamepadState Map(PadState s, HMProfile profile)
    {
        var buttons = HMButton.None;
        if (s.A) buttons |= HMButton.A; if (s.B) buttons |= HMButton.B;
        if (s.X) buttons |= HMButton.X; if (s.Y) buttons |= HMButton.Y;
        if (s.LB) buttons |= HMButton.LeftBumper; if (s.RB) buttons |= HMButton.RightBumper;
        if (s.L3) buttons |= HMButton.LeftStick; if (s.R3) buttons |= HMButton.RightStick;
        if (s.Back) buttons |= HMButton.Back; if (s.Start) buttons |= HMButton.Start;
        return new HMGamepadState {
            Axes = HMGamepadStateHelpers.StandardAxes(profile,
                leftStickX: (float)((s.LeftX + 1) / 2), leftStickY: (float)((s.LeftY + 1) / 2),
                rightStickX: (float)((s.RightX + 1) / 2), rightStickY: (float)((s.RightY + 1) / 2),
                leftTrigger: (float)s.LeftTrigger, rightTrigger: (float)s.RightTrigger),
            Buttons = buttons,
            Hat = Hat(s)
        };
    }
    private static HMHat Hat(PadState s)
    {
        var x = (s.Right ? 1 : 0) - (s.Left ? 1 : 0);
        var y = (s.Down ? 1 : 0) - (s.Up ? 1 : 0);
        return (x,y) switch { (0,-1)=>HMHat.North,(1,-1)=>HMHat.NorthEast,(1,0)=>HMHat.East,(1,1)=>HMHat.SouthEast,(0,1)=>HMHat.South,(-1,1)=>HMHat.SouthWest,(-1,0)=>HMHat.West,(-1,-1)=>HMHat.NorthWest,_=>HMHat.None };
    }
    private void Neutralize(int slot) { if (controllers.ContainsKey(slot)) Set(slot, Neutral); }
    private void NeutralizeAll() { foreach (var slot in controllers.Keys.ToArray()) Neutralize(slot); }
    private void Destroy(int slot) { if (!controllers.Remove(slot, out var ctrl)) return; NeutralStateBeforeDispose(ctrl); ctrl.Dispose(); states.Remove(slot); }
    private static void NeutralStateBeforeDispose(HMController ctrl) { var state = new HMGamepadState { Axes = HMGamepadStateHelpers.StandardAxes(ctrl.Profile) }; ctrl.SubmitState(in state); }
    private static void Write(long id, bool ok, object? data = null, string? error = null)
    {
        var json = JsonSerializer.Serialize(new { id, ok, error, data });
        Console.Out.WriteLine(json);
        Console.Out.Flush();
    }
    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            watchdog.Dispose();
            try { NeutralizeAll(); } catch { }
            foreach (var slot in controllers.Keys.ToArray()) { try { Destroy(slot); } catch { } }
            context.Dispose();
        }
    }
}

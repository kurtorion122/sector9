import { useCallback, useEffect, useRef, useState } from "react";
import { Game, HudData, NetSetup, Phase } from "./game/engine";
import { Banner, Hud, OverScreen, PauseScreen, StartScreen } from "./components/Overlays";
import { Lobby, BeginInfo } from "./components/Lobby";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);

  const [phase, setPhase] = useState<Phase>("menu");
  const [hud, setHud] = useState<HudData | null>(null);
  const [banner, setBanner] = useState<{ id: number; title: string; sub: string } | null>(null);
  const [muted, setMuted] = useState(false);
  const [screen, setScreen] = useState<"game" | "lobby">("game");
  const [netSetup, setNetSetup] = useState<NetSetup | null>(null);

  const onPhase = useCallback((p: Phase) => setPhase(p), []);
  const onHud = useCallback((h: HudData) => setHud(h), []);
  const onBanner = useCallback((title: string, sub: string) => setBanner((b) => ({ id: (b?.id ?? 0) + 1, title, sub })), []);
  const onMute = useCallback((m: boolean) => setMuted(m), []);

  useEffect(() => {
    if (!canvasRef.current || !minimapRef.current) return;
    const game = new Game(canvasRef.current, minimapRef.current, { onPhase, onHud, onBanner, onMute }, netSetup ?? undefined);
    game.vignetteEl = vignetteRef.current;
    gameRef.current = game;
    if (netSetup && netSetup.mode !== "solo") game.begin();
    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, [netSetup, onPhase, onHud, onBanner, onMute]);

  const isMp = netSetup !== null && netSetup.mode !== "solo";

  const startSingle = () => gameRef.current?.start();
  const openLobby = () => setScreen("lobby");

  const closeNet = () => {
    if (netSetup && netSetup.mode !== "solo") netSetup.net.close();
  };

  const handleBegin = (info: BeginInfo) => {
    setNetSetup({ mode: info.mode, net: info.net, players: info.players, seed: info.seed, you: info.you });
    setScreen("game");
    setPhase("playing");
  };

  const handleToMenu = () => {
    if (isMp) {
      closeNet();
      setNetSetup(null);
      setScreen("game");
      setPhase("menu");
    } else {
      gameRef.current?.toMenu();
    }
  };

  const handleRestart = () => {
    if (isMp) {
      // back to lobby to form a new squad
      closeNet();
      setNetSetup(null);
      setScreen("lobby");
      setPhase("menu");
    } else {
      gameRef.current?.start();
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#070b09]">
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full ${phase === "playing" ? "cursor-none" : "cursor-default"}`}
      />

      {/* damage vignette */}
      <div
        ref={vignetteRef}
        className="absolute inset-0 pointer-events-none transition-opacity duration-200"
        style={{ opacity: 0, background: "radial-gradient(ellipse at center, transparent 42%, rgba(190,20,15,0.55) 100%)" }}
      />
      {/* soft static vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.5) 100%)" }}
      />

      <Hud hud={hud} phase={phase} muted={muted} minimapRef={minimapRef} />
      <Banner banner={banner} />

      {screen === "lobby" ? (
        <Lobby onBack={() => setScreen("game")} onBegin={handleBegin} />
      ) : (
        <>
          {phase === "menu" && (
            <StartScreen onStart={startSingle} onMulti={openLobby} best={hud?.best ?? 0} />
          )}
          {phase === "paused" && gameRef.current && (
            <PauseScreen onResume={() => gameRef.current?.resume()} onMenu={handleToMenu} />
          )}
          {phase === "over" && hud && (
            <OverScreen hud={hud} onRestart={handleRestart} onMenu={handleToMenu} />
          )}
        </>
      )}
    </div>
  );
}

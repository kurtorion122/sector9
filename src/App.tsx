import { useEffect, useRef, useState } from "react";
import { Game, HudData, Phase } from "./game/engine";
import { Banner, Hud, OverScreen, PauseScreen, StartScreen } from "./components/Overlays";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);

  const [phase, setPhase] = useState<Phase>("menu");
  const [hud, setHud] = useState<HudData | null>(null);
  const [banner, setBanner] = useState<{ id: number; title: string; sub: string } | null>(null);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !minimapRef.current) return;
    const game = new Game(canvasRef.current, minimapRef.current, {
      onPhase: setPhase,
      onHud: setHud,
      onBanner: (title, sub) => setBanner((b) => ({ id: (b?.id ?? 0) + 1, title, sub })),
      onMute: setMuted,
    });
    game.vignetteEl = vignetteRef.current;
    gameRef.current = game;
    setReady(true);
    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  const g = gameRef.current;

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
        style={{
          opacity: 0,
          background:
            "radial-gradient(ellipse at center, transparent 42%, rgba(190,20,15,0.55) 100%)",
        }}
      />

      {/* soft static vignette for depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.5) 100%)" }}
      />

      <Hud hud={hud} phase={phase} muted={muted} minimapRef={minimapRef} />
      <Banner banner={banner} />

      {ready && phase === "menu" && g && (
        <StartScreen onStart={() => g.start()} best={hud?.best ?? 0} />
      )}
      {phase === "paused" && g && (
        <PauseScreen onResume={() => g.resume()} onMenu={() => g.toMenu()} />
      )}
      {phase === "over" && hud && g && (
        <OverScreen hud={hud} onRestart={() => g.start()} onMenu={() => g.toMenu()} />
      )}
    </div>
  );
}

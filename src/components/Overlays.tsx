import { RefObject } from "react";
import { HudData, Phase } from "../game/engine";

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
};

/* ---------------- inline icons ---------------- */

const IconSkull = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M12 2a8 8 0 0 0-8 8c0 2.9 1.6 5.4 4 6.8V20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3.2c2.4-1.4 4-3.9 4-6.8a8 8 0 0 0-8-8zM8.5 12A1.8 1.8 0 1 1 8.5 8.4 1.8 1.8 0 0 1 8.5 12zm7 0a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6zM12 13l1.2 2.6h-2.4L12 13z" />
  </svg>
);

const IconCross = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden>
    <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" />
  </svg>
);

const IconBolt = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden>
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
  </svg>
);

const IconSound = ({ muted }: { muted: boolean }) => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden>
    <path d="M4 9v6h4l6 5V4L8 9H4z" />
    {muted ? (
      <path d="M16 8l6 8M22 8l-6 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    ) : (
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    )}
  </svg>
);

/* ---------------- HUD ---------------- */

export function Hud({
  hud: hudIn,
  phase,
  muted,
  minimapRef,
}: {
  hud: HudData | null;
  phase: Phase;
  muted: boolean;
  minimapRef: RefObject<HTMLCanvasElement>;
}) {
  const hud: HudData = hudIn ?? {
    hp: 100, wave: 0, left: 0, score: 0, best: 0, newBest: false, kills: 0, wi: 0,
    slots: [0, 1, 2, 3].map((i) => ({ name: "", mag: 0, reserve: 0, reload: -1, owned: i === 0, infinite: i === 0 })),
    dash: 1, time: 0,
  };
  const visible = (phase === "playing" || phase === "paused") && hudIn !== null;
  const lowHp = hud.hp < 32;
  return (
    <div
      className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      {/* top-left: vitals */}
      <div className="absolute top-4 left-4 panel px-4 py-3 w-[230px]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-display text-[10px] tracking-[0.22em] text-[#7fae72]">СОСТОЯНИЕ</span>
          <span className={`flex items-center gap-1 ${muted ? "text-[#6b7d6b]" : "text-[#a8ff3e]"}`}>
            <IconSound muted={muted} />
          </span>
        </div>
        <div className="flex items-end gap-2">
          <span className={`text-[#8fd64a] ${lowHp ? "text-[#ff5040]" : ""}`}><IconCross /></span>
          <div className="flex-1 h-3.5 bg-black/70 border border-[#2c4033] relative overflow-hidden">
            <div
              className={`h-full transition-[width] duration-150 ${lowHp ? "bg-[#ff3b30] anim-lowhp" : "bg-[#a8ff3e]"}`}
              style={{ width: `${hud.hp}%`, boxShadow: lowHp ? "0 0 12px rgba(255,59,48,0.8)" : "0 0 10px rgba(168,255,62,0.6)" }}
            />
          </div>
          <span className={`font-display text-lg leading-none ${lowHp ? "text-[#ff5040] anim-lowhp" : "text-[#d7ffb0]"}`}>
            {hud.hp}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[#5fd8d0]"><IconBolt /></span>
          <div className="flex-1 h-1.5 bg-black/70 border border-[#1e3a38] overflow-hidden">
            <div
              className="h-full bg-[#5fd8d0] transition-[width] duration-100"
              style={{ width: `${Math.round(hud.dash * 100)}%`, boxShadow: "0 0 8px rgba(95,216,208,0.7)" }}
            />
          </div>
          <span className="font-display text-[9px] tracking-widest text-[#4f8f8a]">РЫВОК</span>
        </div>
      </div>

      {/* top-center: score & wave */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center">
        <div className="panel panel-amber px-6 py-2 text-center">
          <div className="font-display text-[9px] tracking-[0.3em] text-[#a58340]">СЧЁТ</div>
          <div className="font-display text-3xl leading-none text-[#ffb020] text-glow-amber tabular-nums">
            {hud.score.toLocaleString("ru-RU")}
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          <div className="panel px-3 py-1 font-display text-xs tracking-widest text-[#a8ff3e]">
            ВОЛНА {Math.max(1, hud.wave)}
          </div>
          <div className="panel panel-alarm px-3 py-1 font-display text-xs tracking-widest text-[#ff6a5e] flex items-center gap-1.5">
            <span className="text-[#ff3b30]"><IconSkull /></span>
            {hud.left}
          </div>
        </div>
      </div>

      {/* top-right: minimap */}
      <div className="absolute top-4 right-4 panel px-2.5 pt-2 pb-2.5">
        <div className="font-display text-[9px] tracking-[0.24em] text-[#7fae72] text-center mb-1.5">
          ТАКТ. КАРТА · С-{Math.max(1, hud.wave)}
        </div>
        <canvas
          ref={minimapRef}
          width={188}
          height={133}
          className="block border border-[#2c4033] bg-black/60"
        />
      </div>

      {/* bottom-center: weapons */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {hud.slots.map((s, i) => {
          const active = i === hud.wi;
          return (
            <div
              key={i}
              className={`panel relative w-[150px] px-3 py-2 transition-all duration-150 ${
                active ? "panel-amber -translate-y-1" : s.owned ? "opacity-75" : "opacity-35"
              }`}
              style={active ? { boxShadow: "0 0 18px rgba(255,176,32,0.25), 0 8px 28px rgba(0,0,0,0.5)" } : undefined}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className={`font-display text-[10px] ${active ? "text-[#ffb020]" : "text-[#5c7d5a]"}`}
                >
                  {i + 1}
                </span>
                <span className={`font-display text-[10px] tracking-wider truncate ml-2 ${active ? "text-[#d7ffb0]" : "text-[#7fae72]"}`}>
                  {s.owned ? s.name : "— НЕТ —"}
                </span>
              </div>
              <div className={`font-display text-lg leading-tight tabular-nums ${active ? "text-white" : "text-[#9dbb95]"}`}>
                {s.owned ? (
                  <>
                    {s.mag}
                    <span className="text-[11px] text-[#7fae72]"> / {s.infinite ? "∞" : s.reserve}</span>
                  </>
                ) : (
                  <span className="text-[11px]">ящик с оружием</span>
                )}
              </div>
              {s.reload >= 0 && (
                <div
                  className="absolute left-0 bottom-0 h-[3px] bg-[#ffb020] transition-[width] duration-100 ease-linear"
                  style={{ width: `${s.reload * 100}%`, boxShadow: "0 0 8px rgba(255,176,32,0.8)" }}
                />
              )}
              {s.owned && !s.infinite && s.mag === 0 && s.reload < 0 && (
                <div className="absolute right-2 top-1.5 font-display text-[9px] text-[#ff5040] anim-blink">ПУСТО</div>
              )}
            </div>
          );
        })}
      </div>

      {/* bottom-left: hints */}
      {phase === "playing" && (
        <div key={visible ? "hint-on" : "hint-off"} className="absolute bottom-4 left-4 anim-hint">
          <div className="panel px-3 py-2 text-[11px] text-[#8fae85] flex items-center gap-2 flex-wrap max-w-[300px]">
            <span className="kbd">WASD</span> движение
            <span className="kbd">ЛКМ</span> огонь
            <span className="kbd">SHIFT</span> рывок
            <span className="kbd">R</span> перезарядка
            <span className="kbd">1–4</span> оружие
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Wave banner ---------------- */

export function Banner({ banner }: { banner: { id: number; title: string; sub: string } | null }) {
  if (!banner) return null;
  return (
    <div key={banner.id} className="absolute inset-x-0 top-[26%] flex flex-col items-center pointer-events-none">
      <div className="anim-banner font-display text-5xl md:text-6xl text-[#a8ff3e] text-glow-phos tracking-[0.12em]">
        {banner.title}
      </div>
      <div className="anim-sub mt-3 font-body text-sm tracking-[0.28em] uppercase text-[#c9e8b8]/80">
        {banner.sub}
      </div>
    </div>
  );
}

/* ---------------- Shared bits ---------------- */

function ControlRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#1d2b22] last:border-0">
      <div className="flex gap-1">
        {keys.map((k) => (
          <span key={k} className="kbd">{k}</span>
        ))}
      </div>
      <span className="text-[13px] text-[#9dbb95]">{label}</span>
    </div>
  );
}

const ENEMIES = [
  { name: "Стрелок", color: "#ff6a2e", note: "держит дистанцию, стреляет очередями" },
  { name: "Жнец", color: "#ff2e5f", note: "быстрый, бросается в ближний бой" },
  { name: "Громила", color: "#e8342e", note: "бронирован, бьёт дробью в упор" },
];

const ARMS = [
  { k: "1", name: "ПМ «ГРОМ»", note: "бесконечный боезапас" },
  { k: "2", name: "«ВЕПРЬ-12»", note: "дробовик · ищите ящик" },
  { k: "3", name: "«ШКВАЛ»", note: "ПП · высокий темп" },
  { k: "4", name: "«ФИЛИН»", note: "винтовка · точный урон" },
];

/* ---------------- Screens ---------------- */

export function StartScreen({ onStart, best }: { onStart: () => void; best: number }) {
  return (
    <div className="absolute inset-0 anim-screen scanlines overflow-y-auto" style={{ background: "radial-gradient(ellipse at 30% 20%, rgba(20,40,25,0.55), rgba(4,7,5,0.82) 70%)" }}>
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="grid md:grid-cols-[1.15fr_1fr] gap-8 max-w-5xl w-full items-center">
          {/* left: identity */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 border-2 border-[#a8ff3e]/60 relative overflow-hidden rounded-full">
                <div className="absolute inset-0 anim-radar" style={{ background: "conic-gradient(from 0deg, rgba(168,255,62,0.7), transparent 70deg)" }} />
              </div>
              <span className="font-display text-[11px] tracking-[0.34em] text-[#7fae72]">ОПЕРАТИВНЫЙ БРИФИНГ // 04:51</span>
            </div>
            <h1 className="font-display text-7xl md:text-8xl leading-[0.95] text-[#a8ff3e] text-glow-phos">
              СЕКТОР<span className="text-[#ffb020] text-glow-amber">-9</span>
            </h1>
            <div className="font-display text-xl md:text-2xl tracking-[0.42em] text-[#d7ffb0]/90 mt-3">ТУМАН ВОЙНЫ</div>
            <p className="text-[14px] leading-relaxed text-[#9dbb95] mt-5 max-w-md">
              Высадка в тёмный сектор. Видно только то, что освещает ваш фонарь — узкий конус спереди.
              Всё остальное прячется в тумане: стены, аптечки и боты, которые уже вас услышали.
              Зачищайте волну за волной, подбирайте оружие и не дайте себя окружить.
            </p>
            <div className="flex items-center gap-4 mt-7">
              <button
                onClick={onStart}
                className="btn-tac pointer-events-auto bg-[#a8ff3e] text-[#0c1408] text-lg px-10 py-4 hover:bg-[#c0ff66]"
                style={{ boxShadow: "0 0 28px rgba(168,255,62,0.35)" }}
              >
                НАЧАТЬ ОПЕРАЦИЮ
              </button>
              {best > 0 && (
                <div className="text-[#a58340] font-display text-sm tracking-wider">
                  РЕКОРД<br />
                  <span className="text-[#ffb020] text-xl">{best.toLocaleString("ru-RU")}</span>
                </div>
              )}
            </div>
            <div className="mt-5 text-[11px] text-[#5c7d5a] tracking-wider">
              ENTER — старт · M — звук · ESC — пауза
            </div>
          </div>

          {/* right: intel panels */}
          <div className="flex flex-col gap-4">
            <div className="panel px-5 py-4">
              <div className="font-display text-[10px] tracking-[0.3em] text-[#7fae72] mb-2">УПРАВЛЕНИЕ</div>
              <ControlRow keys={["W", "A", "S", "D"]} label="передвижение" />
              <ControlRow keys={["МЫШЬ"]} label="прицел · ЛКМ — огонь" />
              <ControlRow keys={["SHIFT"]} label="рывок (кулдаун 2 с)" />
              <ControlRow keys={["R"]} label="перезарядка" />
              <ControlRow keys={["1", "4"]} label="смена оружия / колесо" />
            </div>
            <div className="panel px-5 py-4">
              <div className="font-display text-[10px] tracking-[0.3em] text-[#7fae72] mb-2">АРСЕНАЛ</div>
              {ARMS.map((a) => (
                <div key={a.k} className="flex items-center justify-between py-1.5 border-b border-[#1d2b22] last:border-0">
                  <div className="flex items-center gap-2.5">
                    <span className="kbd">{a.k}</span>
                    <span className="font-display text-[12px] text-[#d7ffb0]">{a.name}</span>
                  </div>
                  <span className="text-[11px] text-[#7fae72]">{a.note}</span>
                </div>
              ))}
            </div>
            <div className="panel panel-alarm px-5 py-4">
              <div className="font-display text-[10px] tracking-[0.3em] text-[#c26a5e] mb-2">РАЗВЕДДАННЫЕ · ВРАГИ</div>
              {ENEMIES.map((e) => (
                <div key={e.name} className="flex items-center gap-2.5 py-1.5 border-b border-[#2b1d1d] last:border-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: e.color, boxShadow: `0 0 8px ${e.color}` }} />
                  <span className="font-display text-[12px] text-[#ffc9c2]">{e.name}</span>
                  <span className="text-[11px] text-[#a58a85] ml-auto text-right">{e.note}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PauseScreen({ onResume, onMenu }: { onResume: () => void; onMenu: () => void }) {
  return (
    <div className="absolute inset-0 anim-screen flex items-center justify-center" style={{ background: "rgba(4,7,5,0.78)", backdropFilter: "blur(2px)" }}>
      <div className="panel px-10 py-8 text-center w-[380px]">
        <div className="font-display text-4xl text-[#a8ff3e] text-glow-phos tracking-[0.2em]">ПАУЗА</div>
        <div className="text-[12px] text-[#7fae72] mt-2 tracking-widest">ОПЕРАЦИЯ ПРИОСТАНОВЛЕНА</div>
        <div className="mt-5 text-left">
          <ControlRow keys={["WASD"]} label="движение" />
          <ControlRow keys={["ЛКМ"]} label="огонь" />
          <ControlRow keys={["SHIFT"]} label="рывок" />
          <ControlRow keys={["R"]} label="перезарядка" />
        </div>
        <div className="flex flex-col gap-2.5 mt-6">
          <button onClick={onResume} className="btn-tac pointer-events-auto bg-[#a8ff3e] text-[#0c1408] px-6 py-3 hover:bg-[#c0ff66]">
            ПРОДОЛЖИТЬ · ESC
          </button>
          <button onClick={onMenu} className="btn-tac pointer-events-auto border border-[#3d5a46] text-[#9dbb95] px-6 py-3 hover:bg-[#16241b] hover:text-[#d7ffb0]">
            ПОКИНУТЬ СЕКТОР
          </button>
        </div>
      </div>
    </div>
  );
}

export function OverScreen({
  hud,
  onRestart,
  onMenu,
}: {
  hud: HudData;
  onRestart: () => void;
  onMenu: () => void;
}) {
  const stats = [
    { label: "СЧЁТ", value: hud.score.toLocaleString("ru-RU"), color: "#ffb020" },
    { label: "УБИЙСТВА", value: String(hud.kills), color: "#ff6a5e" },
    { label: "ВОЛНА", value: String(hud.wave), color: "#a8ff3e" },
    { label: "ВРЕМЯ", value: fmtTime(hud.time), color: "#5fd8d0" },
  ];
  return (
    <div className="absolute inset-0 anim-screen flex items-center justify-center scanlines" style={{ background: "radial-gradient(ellipse at center, rgba(40,8,6,0.6), rgba(4,7,5,0.88) 75%)" }}>
      <div className="w-[440px] text-center">
        {hud.newBest && (
          <div className="font-display text-sm tracking-[0.3em] text-[#ffb020] text-glow-amber anim-blink mb-2">
            ★ НОВЫЙ РЕКОРД ★
          </div>
        )}
        <div className="font-display text-6xl text-[#ff3b30] text-glow-red tracking-[0.08em]">ОПЕРАЦИЯ</div>
        <div className="font-display text-6xl text-[#ff3b30] text-glow-red tracking-[0.08em] -mt-1">ПРОВАЛЕНА</div>
        <div className="text-[12px] tracking-[0.3em] text-[#a58a85] mt-3">СИГНАЛ ПОТЕРЯН · СЕКТОР-9</div>
        <div className="grid grid-cols-2 gap-2.5 mt-7">
          {stats.map((s) => (
            <div key={s.label} className="panel px-4 py-3">
              <div className="font-display text-[9px] tracking-[0.28em] text-[#7fae72]">{s.label}</div>
              <div className="font-display text-2xl tabular-nums" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
        <div className="text-[12px] text-[#7fae72] mt-4">
          Лучший результат: <span className="text-[#ffb020] font-display">{hud.best.toLocaleString("ru-RU")}</span>
        </div>
        <div className="flex flex-col gap-2.5 mt-6">
          <button onClick={onRestart} className="btn-tac bg-[#a8ff3e] text-[#0c1408] px-6 py-3.5 text-lg hover:bg-[#c0ff66]" style={{ boxShadow: "0 0 24px rgba(168,255,62,0.3)" }}>
            ПОВТОРИТЬ ВЫСАДКУ
          </button>
          <button onClick={onMenu} className="btn-tac border border-[#3d5a46] text-[#9dbb95] px-6 py-3 hover:bg-[#16241b] hover:text-[#d7ffb0]">
            В ШТАБ
          </button>
        </div>
      </div>
    </div>
  );
}

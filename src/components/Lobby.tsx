import { useEffect, useRef, useState } from "react";
import { NetClient } from "../game/net";
import { PLAYER_COLORS } from "../game/defs";

export interface BeginInfo {
  mode: "host" | "client";
  net: NetClient;
  players: { id: number; name: string }[];
  seed: number;
  you: number;
}

interface RoomInfo {
  code: string;
  you: number;
  host: number;
  players: { id: number; name: string }[];
}

export function Lobby({ onBack, onBegin }: { onBack: () => void; onBegin: (b: BeginInfo) => void }) {
  const netRef = useRef<NetClient | null>(null);
  const handedOff = useRef(false);
  const [name, setName] = useState(() => {
    try { return localStorage.getItem("sector9_name") || "БОЕЦ-" + (10 + ((Math.random() * 89) | 0)); } catch { return "БОЕЦ"; }
  });
  const [view, setView] = useState<"idle" | "room">("idle");
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "online">("connecting");

  useEffect(() => {
    const net = new NetClient();
    netRef.current = net;
    net.onOpen = () => setStatus("online");
    net.onClose = () => setStatus("connecting");
    net.on("room", (m) => {
      const r = m as RoomInfo & { t: string };
      setRoom({ code: r.code, you: r.you, host: r.host, players: r.players });
      setView("room");
      setError(null);
    });
    net.on("err", (m) => {
      setError((m as { msg: string }).msg);
      setView((v) => v);
    });
    net.on("begin", (m) => {
      const b = m as { seed: number; players: { id: number; name: string }[]; host: number; you: number };
      handedOff.current = true; // game takes over this socket
      onBegin({ mode: b.you === b.host ? "host" : "client", net, players: b.players, seed: b.seed, you: b.you });
    });
    net.connect();
    return () => {
      if (!handedOff.current) net.close();
      netRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveName = (v: string) => {
    setName(v);
    try { localStorage.setItem("sector9_name", v); } catch { /* noop */ }
  };

  const doCreate = () => {
    setError(null);
    netRef.current?.send({ t: "create", name: name.trim() || "БОЕЦ" });
  };
  const doJoin = () => {
    if (!/^\d{4}$/.test(joinCode.trim())) { setError("Введите 4 цифры"); return; }
    setError(null);
    netRef.current?.send({ t: "join", code: joinCode.trim(), name: name.trim() || "БОЕЦ" });
  };
  const doStart = () => netRef.current?.send({ t: "start" });
  const doLeave = () => {
    netRef.current?.send({ t: "leave" });
    setRoom(null);
    setView("idle");
    setError(null);
  };

  const isHost = room ? room.you === room.host : false;

  return (
    <div className="absolute inset-0 anim-screen scanlines overflow-y-auto" style={{ background: "radial-gradient(ellipse at 70% 20%, rgba(20,40,25,0.6), rgba(4,7,5,0.88) 70%)" }}>
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="w-full max-w-xl">
          {/* header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 border-2 border-[#a8ff3e]/60 relative overflow-hidden rounded-full">
                <div className="absolute inset-0 anim-radar" style={{ background: "conic-gradient(from 0deg, rgba(168,255,62,0.7), transparent 70deg)" }} />
              </div>
              <span className="font-display text-[11px] tracking-[0.3em] text-[#7fae72]">СОВМЕСТНАЯ ОПЕРАЦИЯ</span>
            </div>
            <div className={`flex items-center gap-2 text-[10px] font-display tracking-widest ${status === "online" ? "text-[#a8ff3e]" : "text-[#a58340]"}`}>
              <span className={`w-2 h-2 rounded-full ${status === "online" ? "bg-[#a8ff3e]" : "bg-[#ffb020] anim-blink"}`} />
              {status === "online" ? "КАНАЛ СВЯЗИ: ОК" : "ПОДКЛЮЧЕНИЕ…"}
            </div>
          </div>

          <div className="panel px-7 py-6">
            {/* callsign */}
            <div className="mb-6">
              <label className="font-display text-[10px] tracking-[0.3em] text-[#7fae72] block mb-2">ПОЗЫВНОЙ</label>
              <input
                value={name}
                maxLength={14}
                onChange={(e) => saveName(e.target.value)}
                className="w-full bg-black/60 border border-[#2c4033] focus:border-[#a8ff3e] outline-none px-4 py-3 font-display text-lg text-[#d7ffb0] tracking-wider transition-colors"
                placeholder="БОЕЦ"
              />
            </div>

            {view === "idle" && (
              <div className="flex flex-col gap-4">
                <button
                  onClick={doCreate}
                  disabled={status !== "online"}
                  className="btn-tac pointer-events-auto bg-[#a8ff3e] text-[#0c1408] text-lg px-8 py-4 hover:bg-[#c0ff66] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ boxShadow: "0 0 24px rgba(168,255,62,0.3)" }}
                >
                  СОЗДАТЬ КОМНАТУ
                </button>
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-[#2c4033]" />
                  <span className="font-display text-[10px] tracking-[0.3em] text-[#5c7d5a]">ИЛИ</span>
                  <div className="h-px flex-1 bg-[#2c4033]" />
                </div>
                <div className="flex gap-3">
                  <input
                    value={joinCode}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setJoinCode(v);
                    }}
                    placeholder="0000"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={4}
                    className="flex-1 bg-black/60 border border-[#2c4033] focus:border-[#ffb020] outline-none px-4 py-3.5 font-display text-xl text-[#ffb020] tracking-[0.5em] text-center transition-colors"
                  />
                  <button
                    onClick={doJoin}
                    disabled={status !== "online"}
                    className="btn-tac pointer-events-auto border-2 border-[#ffb020] text-[#ffb020] px-8 py-3.5 hover:bg-[#ffb020] hover:text-[#0c1408] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ВОЙТИ
                  </button>
                </div>
                {error && <div className="text-[#ff5040] font-display text-sm tracking-wider anim-blink">⚠ {error}</div>}
                <button onClick={onBack} className="mt-2 text-[#5c7d5a] hover:text-[#9dbb95] font-display text-xs tracking-[0.25em] transition-colors pointer-events-auto self-start">
                  ← НАЗАД В МЕНЮ
                </button>
              </div>
            )}

            {view === "room" && room && (
              <div className="flex flex-col gap-5">
                <div className="text-center">
                  <div className="font-display text-[10px] tracking-[0.3em] text-[#7fae72] mb-1">КОД КОМНАТЫ — передайте бойцам</div>
                  <div className="font-display text-6xl tracking-[0.4em] text-[#ffb020] text-glow-amber pl-3">{room.code}</div>
                </div>

                <div>
                  <div className="font-display text-[10px] tracking-[0.3em] text-[#7fae72] mb-2">ОТРЯД · {room.players.length}/4</div>
                  <div className="flex flex-col gap-2">
                    {[0, 1, 2, 3].map((slot) => {
                      const p = room.players[slot];
                      return (
                        <div key={slot} className={`flex items-center gap-3 border px-4 py-2.5 ${p ? "border-[#2c4033] bg-black/40" : "border-dashed border-[#1d2b22] opacity-40"}`}>
                          <span className="w-3 h-3 rounded-full" style={{ background: p ? PLAYER_COLORS[slot % PLAYER_COLORS.length] : "transparent", border: p ? "none" : "1px solid #2c4033" }} />
                          <span className={`font-display text-sm tracking-wider ${p ? "text-[#d7ffb0]" : "text-[#5c7d5a]"}`}>
                            {p ? p.name : "ОЖИДАНИЕ БОЙЦА…"}
                          </span>
                          {p && p.id === room.host && <span className="ml-auto font-display text-[9px] tracking-widest text-[#ffb020] border border-[#ffb020]/50 px-2 py-0.5">ХОСТ</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="text-[11px] text-[#5c7d5a] leading-relaxed">
                  Сложность растёт с каждым бойцом в отряде. Одиночная игра сохраняет обычный баланс.
                </div>

                {isHost ? (
                  <button
                    onClick={doStart}
                    className="btn-tac pointer-events-auto bg-[#a8ff3e] text-[#0c1408] text-lg px-8 py-4 hover:bg-[#c0ff66]"
                    style={{ boxShadow: "0 0 24px rgba(168,255,62,0.3)" }}
                  >
                    НАЧАТЬ ОПЕРАЦИЮ ▸
                  </button>
                ) : (
                  <div className="text-center font-display text-sm tracking-[0.2em] text-[#a58340] anim-blink">
                    ОЖИДАНИЕ ПРИКАЗА ХОСТА…
                  </div>
                )}

                {error && <div className="text-[#ff5040] font-display text-sm tracking-wider anim-blink">⚠ {error}</div>}

                <button onClick={doLeave} className="text-[#5c7d5a] hover:text-[#9dbb95] font-display text-xs tracking-[0.25em] transition-colors pointer-events-auto self-start">
                  ← ПОКИНУТЬ КОМНАТУ
                </button>
              </div>
            )}
          </div>

          <div className="text-center mt-4 text-[10px] text-[#5c7d5a] tracking-wider">
            Все игроки должны открыть один и тот же адрес сервера · хост управляет запуском
          </div>
        </div>
      </div>
    </div>
  );
}

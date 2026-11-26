import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Crosshair,
  Gauge,
  Pause,
  Play,
  Rocket,
  RotateCcw,
  Shield,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { Game } from "../game/engine";
import { CAP, initialSnapshot, shotCount, type ScoreEntry, type Snapshot, type UpgradeKind } from "../game/types";

const btn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold active:scale-95 disabled:opacity-40";
const primary = `${btn} bg-ice text-bg hover:opacity-90`;
const ghost = `${btn} border border-line bg-surface text-fg hover:border-ice`;

function useCoarse(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 820px)");
    const apply = () => setCoarse(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return coarse;
}

export function SpaceGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [snap, setSnap] = useState<Snapshot>(initialSnapshot);
  const [panel, setPanel] = useState<"home" | "board">("home");
  const [name, setName] = useState("");
  const coarse = useCoarse();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new Game(canvas, setSnap);
    gameRef.current = game;
    game.start();
    return () => {
      game.stop();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (snap.mode === "over") setName("");
    if (snap.mode === "menu" || snap.mode === "paused") setPanel("home");
  }, [snap.mode]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <canvas
        ref={canvasRef}
        className={
          snap.mode === "playing"
            ? "absolute inset-0 h-full w-full cursor-crosshair touch-none"
            : "absolute inset-0 h-full w-full touch-none"
        }
        aria-label="ساحة اللعب"
      />

      {snap.mode === "playing" ? <Hud snap={snap} onPause={() => gameRef.current?.togglePause()} /> : null}

      {snap.mode === "menu" ? (
        <Menu
          snap={snap}
          panel={panel}
          coarse={coarse}
          onPanel={setPanel}
          onStart={() => gameRef.current?.begin()}
        />
      ) : null}

      {snap.mode === "paused" ? (
        <PauseMenu
          snap={snap}
          panel={panel}
          onPanel={setPanel}
          onResume={() => gameRef.current?.resume()}
          onRestart={() => gameRef.current?.restart()}
          onMenu={() => gameRef.current?.toMenu()}
          onMute={() => gameRef.current?.toggleMute()}
          onShake={() => gameRef.current?.toggleShake()}
          onAuto={() => gameRef.current?.toggleAuto()}
        />
      ) : null}

      {snap.mode === "upgrade" ? <Upgrade snap={snap} onPick={(kind) => gameRef.current?.pick(kind)} /> : null}

      {snap.mode === "over" ? (
        <GameOver
          snap={snap}
          name={name}
          onName={setName}
          onSave={() => gameRef.current?.saveName(name)}
          onSkip={() => gameRef.current?.skipSave()}
          onRestart={() => gameRef.current?.restart()}
          onMenu={() => gameRef.current?.toMenu()}
        />
      ) : null}

      {coarse && snap.mode === "playing" ? (
        <Touch
          onStick={(x, y, active) => gameRef.current?.setStick(x, y, active)}
          onFire={(held) => gameRef.current?.setFire(held)}
        />
      ) : null}
    </div>
  );
}

function Num({ value }: { value: number }) {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {value.toLocaleString("en-US")}
    </span>
  );
}

function Hud({ snap, onPause }: { snap: Snapshot; onPause: () => void }) {
  return (
    <>
      <div
        className="safe-top pointer-events-none absolute inset-x-0 z-20 flex items-start justify-between gap-2 px-3"
        dir="ltr"
      >
        <button
          type="button"
          className={`${ghost} pointer-events-auto size-12 shrink-0 px-0`}
          onClick={onPause}
          aria-label="إيقاف مؤقت"
        >
          <Pause className="size-5" />
        </button>
        <div className="min-w-0 flex-1 px-2 pt-1 text-center" dir="rtl">
          <p className="truncate text-lg font-extrabold">{snap.banner || `الموجة ${snap.wave}`}</p>
          <p className="text-sm text-muted">
            متبقٍ <Num value={snap.remaining} />
            {snap.combo >= 2 ? (
              <span className="text-gold">
                {" "}
                · سلسلة ×<Num value={snap.combo} />
              </span>
            ) : null}
          </p>
        </div>
        <div className="min-w-20 shrink-0 pt-1 text-right" dir="rtl">
          <p className="text-xs text-muted">النقاط</p>
          <p className="text-2xl font-extrabold leading-none text-gold">
            <Num value={snap.score} />
          </p>
          {snap.best > 0 && snap.score > snap.best ? <p className="text-xs text-ice">رقم جديد</p> : null}
        </div>
      </div>

      <div className="hud-status pointer-events-none absolute inset-x-0 z-20 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-3 text-sm">
        <span className="inline-flex items-center gap-1" aria-label={`المحاولات ${snap.lives}`}>
          {Array.from({ length: 3 }, (_, i) => (
            <Rocket key={i} className={i < snap.lives ? "size-4 text-ice" : "size-4 text-line"} aria-hidden />
          ))}
          <span className="text-muted">
            <Num value={snap.lives} />
          </span>
        </span>
        <span className="inline-flex items-center gap-1" aria-label={`الدرع ${snap.shield}`}>
          <Shield className={snap.shield > 0 ? "size-4 text-ice" : "size-4 text-line"} aria-hidden />
          <span className="text-muted">
            <Num value={snap.shield} />/<Num value={snap.shieldMax} />
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-muted" aria-label="طلقات الرشقة">
          <Crosshair className="size-4 text-ice" aria-hidden />
          <Num value={shotCount(snap.multi)} />
        </span>
        <span className="inline-flex items-center gap-1 text-muted" aria-label="مستوى السرعة">
          <Gauge className="size-4 text-gold" aria-hidden />
          <Num value={snap.speed} />
        </span>
      </div>

      {snap.shieldMax > snap.shield && snap.shieldMax > 0 ? (
        <div className="hud-regen pointer-events-none absolute inset-x-0 z-20 mx-auto h-1 w-24 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-ice" style={{ width: `${Math.round(snap.shieldRegen * 100)}%` }} />
        </div>
      ) : null}

      {snap.bossMax > 0 ? (
        <div className="hud-boss pointer-events-none absolute inset-x-0 z-20 mx-auto w-48">
          <div className="mb-1 text-center text-xs text-gold">الطراد</div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-ember" style={{ width: `${Math.round((snap.bossHp / snap.bossMax) * 100)}%` }} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function Menu({
  snap,
  panel,
  coarse,
  onPanel,
  onStart,
}: {
  snap: Snapshot;
  panel: "home" | "board";
  coarse: boolean;
  onPanel: (panel: "home" | "board") => void;
  onStart: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-bg/45">
      <div className="flex min-h-full items-center justify-center p-4 sm:justify-start sm:p-12">
        <section className="w-full max-w-md rounded-2xl border border-line bg-surface/95 p-6">
          {panel === "board" ? (
            <>
              <p className="font-mono text-xs tracking-widest text-ice">سجل القادة</p>
              <h2 className="mt-1 text-3xl font-extrabold text-balance">لوحة أعلى النتائج</h2>
              <div className="mt-5">
                <Board rows={snap.scores} />
              </div>
              <button type="button" className={`${ghost} mt-6 w-full`} onClick={() => onPanel("home")}>
                رجوع
              </button>
            </>
          ) : (
            <>
              <p className="font-mono text-xs tracking-widest text-ice">حقل إطلاق مداري</p>
              <h1 className="mt-2 text-5xl font-extrabold leading-none text-balance sm:text-6xl">سَديم</h1>
              <p className="mt-3 text-pretty text-muted">
                قُد المقاتلة بين النجوم، اكسر الموجات، واختر ترقيتك قبل أن يضيق الطوق.
              </p>
              <div className="mt-6 flex flex-col gap-3">
                <button type="button" className={primary} onClick={onStart}>
                  <Play className="size-5" />
                  ابدأ
                  <span className="font-mono text-xs tracking-widest">Start</span>
                </button>
                <button type="button" className={ghost} onClick={() => onPanel("board")}>
                  <Trophy className="size-5 text-gold" />
                  لوحة النتائج
                </button>
              </div>
              {snap.best > 0 ? (
                <p className="mt-4 text-sm text-muted">
                  أفضل نتيجة <Num value={snap.best} />
                </p>
              ) : null}
              <ul className="mt-5 flex flex-col gap-2 text-sm text-muted">
                <li>WASD أو الأسهم للحركة، والمؤشر يجرّ السفينة إذا رفعت يدك عن الأزرار.</li>
                <li>مع لوحة المفاتيح صوّب بالمؤشر. من دون فأرة يلتصق التصويب بأقرب عدو.</li>
                <li>الإطلاق: المسافة أو زر الفأرة. الإيقاف: Esc.</li>
                {coarse ? <li>على اللمس: عصا يسار، وزر الإطلاق يمين.</li> : null}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function PauseMenu({
  snap,
  panel,
  onPanel,
  onResume,
  onRestart,
  onMenu,
  onMute,
  onShake,
  onAuto,
}: {
  snap: Snapshot;
  panel: "home" | "board";
  onPanel: (panel: "home" | "board") => void;
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onMute: () => void;
  onShake: () => void;
  onAuto: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-bg/55">
      <div className="flex min-h-full items-center justify-center p-4">
        <section className="w-full max-w-md rounded-2xl border border-line bg-surface p-6">
          {panel === "board" ? (
            <>
              <h2 className="text-2xl font-extrabold">لوحة أعلى النتائج</h2>
              <div className="mt-4">
                <Board rows={snap.scores} />
              </div>
              <button type="button" className={`${ghost} mt-5 w-full`} onClick={() => onPanel("home")}>
                رجوع
              </button>
            </>
          ) : (
            <>
              <p className="font-mono text-xs tracking-widest text-gold">متوقف</p>
              <h2 className="mt-1 text-3xl font-extrabold">إيقاف مؤقت</h2>
              <p className="mt-2 text-sm text-muted">
                الموجة <Num value={snap.wave} /> · النقاط <Num value={snap.score} />
              </p>
              <div className="mt-5 flex flex-col gap-3">
                <button type="button" className={primary} onClick={onResume}>
                  <Play className="size-5" />
                  متابعة
                </button>
                <button type="button" className={ghost} onClick={onRestart}>
                  <RotateCcw className="size-5" />
                  إعادة المحاولة
                </button>
                <button type="button" className={ghost} onClick={() => onPanel("board")}>
                  <Trophy className="size-5 text-gold" />
                  لوحة النتائج
                </button>
                <button type="button" className={ghost} onClick={onMute}>
                  {snap.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
                  {snap.muted ? "الصوت مكتوم" : "كتم الصوت"}
                </button>
                <button type="button" className={ghost} onClick={onShake}>
                  <Zap className="size-5" />
                  {snap.shake ? "اهتزاز الشاشة: يعمل" : "اهتزاز الشاشة: متوقف"}
                </button>
                <button type="button" className={ghost} onClick={onAuto}>
                  <Crosshair className="size-5" />
                  {snap.autoFire ? "إطلاق تلقائي: يعمل" : "إطلاق تلقائي: متوقف"}
                </button>
                <button type="button" className={ghost} onClick={onMenu}>
                  القائمة الرئيسية
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Upgrade({ snap, onPick }: { snap: Snapshot; onPick: (kind: UpgradeKind) => void }) {
  const shots = shotCount(snap.multi);
  const nextShots = shotCount(Math.min(CAP.multi, snap.multi + 1));
  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-bg/60">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-3xl">
          <p className="text-center font-mono text-xs tracking-widest text-ice">بين الموجات</p>
          <h2 className="mt-1 text-center text-3xl font-extrabold text-balance sm:text-4xl">اختر ترقية</h2>
          <p className="mt-2 text-center text-muted">
            الموجة <Num value={snap.wave} /> انكسرت · النقاط <Num value={snap.score} />
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <UpgradeCard
              kicker="1"
              icon={<Crosshair className="size-5 text-ice" />}
              title="إطلاق متعدد"
              detail={
                snap.multi >= CAP.multi
                  ? "بلغت الحد. الاختيار يمنحك ٤٠٠ نقطة."
                  : `الآن ${shots} طلقات في الرشقة. التالي ${nextShots}.`
              }
              meta={snap.multi >= CAP.multi ? "الحد الأقصى" : `المستوى ${snap.multi} / ${CAP.multi}`}
              onPick={() => onPick("multi")}
            />
            <UpgradeCard
              kicker="2"
              icon={<Shield className="size-5 text-ice" />}
              title="درع طاقة"
              detail={
                snap.shieldMax >= CAP.shield
                  ? "بلغت الحد. الاختيار يمنحك ٤٠٠ نقطة."
                  : "شحنة تمتص ضربة كاملة، ثم تعود وحدها بعد مهلة."
              }
              meta={snap.shieldMax >= CAP.shield ? "الحد الأقصى" : `الشحنات ${snap.shieldMax} / ${CAP.shield}`}
              onPick={() => onPick("shield")}
            />
            <UpgradeCard
              kicker="3"
              icon={<Gauge className="size-5 text-gold" />}
              title="دفع إضافي"
              detail={
                snap.speed >= CAP.speed
                  ? "بلغت الحد. الاختيار يمنحك ٤٠٠ نقطة."
                  : "تسارع أنعم وحدّ أعلى للمراوغة بين الطلقات."
              }
              meta={snap.speed >= CAP.speed ? "الحد الأقصى" : `المستوى ${snap.speed} / ${CAP.speed}`}
              onPick={() => onPick("speed")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function UpgradeCard({
  kicker,
  icon,
  title,
  detail,
  meta,
  onPick,
}: {
  kicker: string;
  icon: ReactNode;
  title: string;
  detail: string;
  meta: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex min-h-44 flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-4 text-right transition hover:border-ice focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
    >
      <span className="flex w-full items-center justify-between text-muted">
        {icon}
        <span className="font-mono text-xs">{kicker}</span>
      </span>
      <span className="text-xl font-extrabold">{title}</span>
      <span className="text-pretty text-sm text-muted">{detail}</span>
      <span className="mt-auto font-mono text-xs text-gold">{meta}</span>
    </button>
  );
}

function GameOver({
  snap,
  name,
  onName,
  onSave,
  onSkip,
  onRestart,
  onMenu,
}: {
  snap: Snapshot;
  name: string;
  onName: (value: string) => void;
  onSave: () => void;
  onSkip: () => void;
  onRestart: () => void;
  onMenu: () => void;
}) {
  const showForm = snap.qualifies && !snap.saved;
  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-bg/65">
      <div className="flex min-h-full items-center justify-center p-4">
        <section className="w-full max-w-md rounded-2xl border border-line bg-surface p-6">
          <p className="font-mono text-xs tracking-widest text-ember">انقطع الاتصال</p>
          <h2 className="mt-1 text-3xl font-extrabold text-balance">نفدت المحاولات</h2>
          <p className="mt-3 text-4xl font-extrabold text-gold">
            <Num value={snap.score} />
          </p>
          <p className="mt-1 text-sm text-muted">
            وصلت إلى الموجة <Num value={snap.wave} />
          </p>
          {showForm ? (
            <form
              className="mt-5 flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                onSave();
              }}
            >
              <label className="text-sm" htmlFor="pilot-name">
                سجّل اسمك على اللوحة
              </label>
              <input
                id="pilot-name"
                value={name}
                onChange={(event) => onName(event.target.value)}
                maxLength={16}
                placeholder="اسم القائد"
                aria-label="اسم القائد"
                className="min-h-12 rounded-xl border border-line bg-bg px-4 text-fg outline-none focus-visible:border-ice"
              />
              <button type="submit" className={primary}>
                حفظ النتيجة
              </button>
              <button type="button" className={ghost} onClick={onSkip}>
                تخطي
              </button>
            </form>
          ) : (
            <div className="mt-5">
              {!snap.qualifies && snap.score > 0 ? (
                <p className="mb-3 text-sm text-muted">لم تدخل أفضل ثمانية هذه المرة.</p>
              ) : null}
              <Board rows={snap.scores} />
            </div>
          )}
          <div className="mt-5 flex flex-col gap-3">
            <button type="button" className={primary} onClick={onRestart}>
              <RotateCcw className="size-5" />
              محاولة جديدة
            </button>
            <button type="button" className={ghost} onClick={onMenu}>
              القائمة
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Board({ rows }: { rows: ScoreEntry[] }) {
  if (!rows.length) {
    return <p className="text-pretty text-sm text-muted">لم يُسجَّل أحد بعد. أول إسقاط يكتب اسمك هنا.</p>;
  }
  return (
    <ol className="flex flex-col">
      {rows.map((row, index) => (
        <li
          key={`${row.at}-${row.name}-${index}`}
          className="grid grid-cols-[auto_1fr_auto] items-baseline gap-3 border-b border-line py-2"
        >
          <span className="font-mono text-sm text-muted" dir="ltr">
            {index + 1}
          </span>
          <span className="truncate">
            <span className="font-bold">{row.name}</span>
            <span className="mt-0.5 block text-xs text-muted">الموجة {row.wave}</span>
          </span>
          <span className="font-mono text-gold tabular-nums" dir="ltr">
            {row.score.toLocaleString("en-US")}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Touch({
  onStick,
  onFire,
}: {
  onStick: (x: number, y: number, active: boolean) => void;
  onFire: (held: boolean) => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const move = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = rect.width / 2;
    const len = Math.hypot(dx, dy) || 1;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    setKnob({ x: dx, y: dy });
    onStick(dx / max, dy / max, true);
  };

  const end = () => {
    setKnob({ x: 0, y: 0 });
    onStick(0, 0, false);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20" dir="ltr">
      <div
        ref={baseRef}
        className="safe-bottom safe-left pointer-events-auto absolute size-32 rounded-full border border-line bg-surface/70"
        aria-label="تحريك"
        role="application"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event.clientX, event.clientY);
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <span
          className="absolute top-1/2 left-1/2 size-12 rounded-full bg-ice"
          style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
        />
      </div>
      <button
        type="button"
        className="safe-bottom safe-right pointer-events-auto absolute flex size-24 items-center justify-center rounded-full border border-ember bg-ember text-sm font-extrabold text-bg"
        aria-label="إطلاق"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          onFire(true);
        }}
        onPointerUp={() => onFire(false)}
        onPointerCancel={() => onFire(false)}
      >
        إطلاق
      </button>
    </div>
  );
}

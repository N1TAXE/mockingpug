'use client';

import { JetBrains_Mono, Nunito } from 'next/font/google';
import Image from 'next/image';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import styles from './home.module.scss';

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800', '900'],
  variable: '--home-font-ui',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700', '800'],
  variable: '--home-font-code',
  display: 'swap',
});

export const GITHUB_URL = 'https://github.com/N1TAXE/mockingpug';

function cx(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

// Rounds to the nearest hundred before dividing by 1000, so 2180 -> "2.2k"
// and 2149 -> "2.1k"; drops the decimal for whole thousands (1000 -> "1k").
function formatStarCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = Math.round(count / 100) / 10;
  return Number.isInteger(thousands) ? `${thousands}k` : `${thousands.toFixed(1)}k`;
}

// Shared scroll-reveal animation: respects prefers-reduced-motion via the
// `shouldReduce` flag threaded in from the top so every section opts out
// the same way, rather than each one re-checking the media query itself.
function useRevealVariants(shouldReduce: boolean | null): Variants {
  if (shouldReduce) {
    return { hidden: { opacity: 1 }, visible: { opacity: 1 } };
  }
  return {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
  };
}

function Reveal({
  children,
  className,
  shouldReduce,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  shouldReduce: boolean | null;
  delay?: number;
}) {
  const variants = useRevealVariants(shouldReduce);
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      variants={variants}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

function Header({ githubStars }: { githubStars: number | null }) {
  const { setOpenSearch } = useSearchContext();
  return (
    <header className={styles.header}>
      <div className={styles['header__inner']}>
        <nav className={styles['header__nav']}>
          <Link href="/" className={styles['header__logo']}>
            <span className={styles['header__logo-mark']}>
              <LogoMark />
            </span>
            mockingpug
          </Link>
          <Link href="/docs" className={styles['header__link']}>
            Docs
          </Link>
        </nav>
        <div className={styles['header__actions']}>
          <button
            type="button"
            className={styles['header__search']}
            onClick={() => setOpenSearch(true)}
            aria-label="Open search"
          >
            <span className={styles['header__search-left']}>
              <SearchIcon />
              Search
            </span>
            <span className={styles['header__kbd-group']}>
              <span className={styles['header__kbd']}>Ctrl</span>
              <span className={styles['header__kbd']}>K</span>
            </span>
          </button>
          <a
            className={styles['header__github']}
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            <GithubIcon />
            <span>{githubStars !== null ? formatStarCount(githubStars) : 'GitHub'}</span>
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero({ shouldReduce }: { shouldReduce: boolean | null }) {
  return (
    <section className={styles.hero}>
      <div className={styles['hero__inner']}>
        <Reveal shouldReduce={shouldReduce} className={styles['hero__copy']}>
          <h1 className={styles['hero__title']}>
            Describe your data once.
            <br />
            Get a real API, <span className={styles['hero__title-highlight']}>instantly.</span>
          </h1>
          <p className={styles['hero__subtitle']}>
            mockingpug turns one JSON schema into a deterministic, relational dataset, then serves it over the
            exact endpoints your app already calls.
          </p>
          <div className={styles['hero__actions']}>
            <Link href="/docs/getting-started" className={styles['hero__cta']}>
              Get started
            </Link>
            <a
              className={styles['hero__ghost']}
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              View on GitHub
            </a>
          </div>
        </Reveal>

        <Reveal shouldReduce={shouldReduce} className={styles['hero__panels']} delay={0.1}>
          <div className={styles.panel}>
            <div className={styles['panel__head']}>
              <span className={styles['panel__path']}>mock/api/user/schema.json</span>
              <span className={cx(styles['panel__badge'], styles['panel__badge--schema'])}>SCHEMA</span>
            </div>
            <pre className={styles['panel__code']}>
              {'{\n'}
              {'  '}
              <span className={styles['token--key']}>&quot;amount&quot;</span>: 1000,{'\n'}
              {'  '}
              <span className={styles['token--key']}>&quot;data&quot;</span>: {'{\n'}
              {'    '}
              <span className={styles['token--key']}>&quot;id&quot;</span>:{' '}
              <span className={styles['token--type']}>&quot;number.increment&quot;</span>,{'\n'}
              {'    '}
              <span className={styles['token--key']}>&quot;name&quot;</span>:{' '}
              <span className={styles['token--type']}>&quot;username.FS&quot;</span>,{'\n'}
              {'    '}
              <span className={styles['token--key']}>&quot;role&quot;</span>:{' '}
              <span className={styles['token--type']}>&quot;role&quot;</span>,{'\n'}
              {'    '}
              <span className={styles['token--key']}>&quot;posts&quot;</span>:{' '}
              <span className={styles['token--type']}>&quot;data.blogpost&quot;</span>
              {'\n  }\n}'}
            </pre>
          </div>

          <div className={styles['hero__arrow']} aria-hidden="true">
            →
          </div>

          <div className={styles.panel}>
            <div className={styles['panel__head']}>
              <span className={styles['panel__path']}>GET /api/user/1</span>
              <span className={cx(styles['panel__badge'], styles['panel__badge--ok'])}>200 OK</span>
            </div>
            <pre className={styles['panel__code']}>
              {'{\n  '}
              <span className={styles['token--key']}>&quot;id&quot;</span>: 1,{'\n  '}
              <span className={styles['token--key']}>&quot;name&quot;</span>:{' '}
              <span className={styles['token--value']}>&quot;Elena Ruiz&quot;</span>,{'\n  '}
              <span className={styles['token--key']}>&quot;role&quot;</span>:{' '}
              <span className={styles['token--value']}>&quot;ADMIN&quot;</span>,{'\n  '}
              <span className={styles['token--key']}>&quot;posts&quot;</span>: [{'\n    '}
              {'{ '}
              <span className={styles['token--key']}>&quot;title&quot;</span>:{' '}
              <span className={styles['token--value']}>&quot;…&quot;</span>
              {' },\n    '}
              <span className={styles['token--muted']}>// 6 more, resolved live</span>
              {'\n  ]\n}'}
            </pre>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function HowItWorks({ shouldReduce }: { shouldReduce: boolean | null }) {
  return (
    <section className={styles.how} id="how">
      <div className={styles['how__inner']}>
        <div className={styles['how__steps']}>
          <Reveal shouldReduce={shouldReduce}>
            <div className={styles.step}>
              <div className={styles['step__copy']}>
                <div className={styles['step__label']}>
                  <div className={styles['step__eyebrow']}>First step</div>
                  <h3 className={styles['step__title']}>Describe</h3>
                </div>
                <p className={styles['step__text']}>
                  One JSON file per entity. Field-level relations (
                  <code className={styles['step__code-inline']}>data.user.id</code>) and inverse relations resolve
                  automatically.
                </p>
              </div>
              <div className={styles['step__code']}>
                <span className={styles['token--muted']}>
                  {'// mock/data/role.json: a weighted custom dictionary'}
                </span>
                {'\n[\n  { '}
                <span className={styles['token--key']}>&quot;value&quot;</span>:{' '}
                <span className={styles['token--value']}>&quot;ADMIN&quot;</span>,{' '}
                <span className={styles['token--key']}>&quot;max&quot;</span>: 5{' },\n  { '}
                <span className={styles['token--key']}>&quot;value&quot;</span>:{' '}
                <span className={styles['token--value']}>&quot;USER&quot;</span>,{' '}
                <span className={styles['token--key']}>&quot;chance&quot;</span>: 0.9{' }\n]'}
              </div>
            </div>
          </Reveal>

          <Reveal shouldReduce={shouldReduce} className={styles.stepWrapper} delay={0.06}>
            <div className={styles.step}>
              <div className={styles['step__copy']}>
                <div className={styles['step__label']}>
                  <div className={styles['step__eyebrow']}>Second step</div>
                  <h3 className={styles['step__title']}>Generate</h3>
                </div>
                <p className={styles['step__text']}>
                  Validate before anything runs, then generate a fully relational, deterministic dataset from your
                  seed.
                </p>
              </div>
              <div className={styles['step__code']}>
                <span className={styles['token--key']}>$</span> npx mpug doctor{'\n'}
                <span className={styles['token--muted']}>[mockingpug] 2 entities validated OK</span>
                {'\n\n'}
                <span className={styles['token--key']}>$</span> npx mpug generate{'\n'}
                <span className={styles['token--muted']}>[mockingpug] user: generated (1000 records)</span>
              </div>
            </div>
          </Reveal>

          <Reveal shouldReduce={shouldReduce} delay={0.12}>
            <div className={styles.step}>
              <div className={styles['step__copy']}>
                <div className={styles['step__label']}>
                  <div className={styles['step__eyebrow']}>Third step</div>
                  <h3 className={styles['step__title']}>Serve</h3>
                </div>
                <p className={styles['step__text']}>
                  Pick a transport. Same schema, same generated data, same{' '}
                  <code className={styles['step__code-inline']}>query</code> resolver underneath, whether
                  that&apos;s React (MSW) or Next.js (a real Route Handler).
                </p>
              </div>
              <div className={styles['step__code']}>
                <span className={styles['token--muted']}>{'// app/api/[[...mock]]/route.ts'}</span>
                {'\n'}
                <span className={styles['token--key']}>import</span> {'{ createNextHandlers, getMockContext }'}{' '}
                <span className={styles['token--key']}>from</span>{' '}
                <span className={styles['token--value']}>&apos;mockingpug/next&apos;</span>;{'\n\n'}
                <span className={styles['token--key']}>const</span> handlers = getMockContext(process.cwd())
                {'\n  .then(({ ctx }) => createNextHandlers(ctx));'}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Features({ shouldReduce }: { shouldReduce: boolean | null }) {
  const flags: Array<{ flag: string; text: React.ReactNode }> = [
    {
      flag: '--seed',
      text: (
        <>
          Every value is a pure function of seed + entity + index + field. Same seed, same dataset, on every
          machine and every run.
        </>
      ),
    },
    {
      flag: '--relations',
      text: (
        <>
          Field-level (<code className={styles['feature__code-inline']}>data.user.id</code>) and inverse (
          <code className={styles['feature__code-inline']}>data.blogpost</code>) relations resolve automatically,
          with cycle detection at validation time.
        </>
      ),
    },
    {
      flag: '--reconcile',
      text: 'Change one field on a 10,000-record entity and only that field regenerates. Manual test mutations survive.',
    },
    {
      flag: '--rest',
      text: 'Pagination (page / offset / cursor), field filtering, substring search, sorting, full CRUD, and consistent error shapes, generated per entity instead of hand-wired.',
    },
    {
      flag: '--chaos',
      text: (
        <>
          <code className={styles['feature__code-inline']}>runtime.delay</code> /{' '}
          <code className={styles['feature__code-inline']}>runtime.errorRate</code> inject latency and failures
          live, from a devtools panel, so you can test your loading and error states on demand.
        </>
      ),
    },
    {
      flag: '--types',
      text: (
        <>
          <code className={styles['feature__code-inline']}>mockingpug types</code> emits a{' '}
          <code className={styles['feature__code-inline']}>.d.ts</code> straight from your schema, so there are no
          hand-duplicated interfaces to drift out of sync.
        </>
      ),
    },
    {
      flag: '--devtools',
      text: 'Toggle mock/real network, inspect and reset records per entity, bypass a single endpoint once its real backend is ready.',
    },
    {
      flag: '--ci',
      text: (
        <>
          <code className={styles['feature__code-inline']}>doctor --strict</code> and{' '}
          <code className={styles['feature__code-inline']}>--assert-prod-safe</code> catch broken schemas and
          leaked mock code before they ship.
        </>
      ),
    },
  ];

  return (
    <section className={styles.features} id="features">
      <div className={styles['features__inner']}>
        <Reveal shouldReduce={shouldReduce} className={styles['features__head']}>
          <div className={styles['features__eyebrow']}>Under the hood</div>
          <h2 className={styles['features__title']}>Some features</h2>
        </Reveal>
        <div className={styles['features__grid']}>
          {flags.map((item, i) => (
            <Reveal shouldReduce={shouldReduce} key={item.flag} delay={(i % 4) * 0.05}>
              <div className={styles.feature}>
                <span className={styles['feature__flag']}>{item.flag}</span>
                <p className={styles['feature__text']}>{item.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FrameworkStrip() {
  return (
    <section className={styles.strip}>
      <div className={styles['strip__inner']}>
        <span className={styles['strip__label']}>RUNS WHEREVER YOUR APP DOES</span>
        <div className={styles['strip__pills']}>
          <span className={cx(styles.pill, styles['pill--react'])}>
            React <span className={styles.pill__muted}>via MSW</span>
          </span>
          <span className={cx(styles.pill, styles['pill--next'])}>
            Next.js <span className={styles.pill__muted}>App Router</span>
          </span>
          <span className={cx(styles.pill, styles['pill--vite'])}>
            Vite <span className={styles.pill__muted}>auto-discovery</span>
          </span>
          <span className={cx(styles.pill, styles['pill--cli'])}>
            CLI <span className={styles.pill__muted}>standalone</span>
          </span>
        </div>
      </div>
    </section>
  );
}

function DevtoolsDemo({ shouldReduce }: { shouldReduce: boolean | null }) {
  const [masked, setMasked] = useState(false);
  const fields = { name: 'Elena Ruiz', role: 'ADMIN', email: 'elena.492@gmail.com' };
  const mask = (value: string) => '*'.repeat(value.length);

  return (
    <section className={styles.devtools}>
      <div className={styles['devtools__inner']}>
        <div className={styles['devtools__layout']}>
          <Reveal shouldReduce={shouldReduce} className={styles['devtools__copy']}>
            <div className={styles['devtools__eyebrow']}>&lt;MockDevtools/&gt;</div>
            <h2 className={styles['devtools__title']}>A handy debugging tool</h2>
            <p className={styles['devtools__text']}>
              Devtools helps you visually locate mock data on a page by hiding it with asterisks <code className={styles['devtools__code-inline']}>***</code>. You can easily view each individual mock data model and add response delays or error rates to requests.
            </p>
          </Reveal>

          <Reveal shouldReduce={shouldReduce} delay={0.1} className={styles['devtools__card']}>
            <div className={styles['devtools__row']}>
              <span className={styles['devtools__row-label']}>NAME</span>
              <span className={cx(styles['devtools__row-value'], masked && styles['devtools__row-value--masked'])}>
                {masked ? mask(fields.name) : fields.name}
              </span>
            </div>
            <div className={styles['devtools__row']}>
              <span className={styles['devtools__row-label']}>ROLE</span>
              <span className={cx(styles['devtools__row-value'], masked && styles['devtools__row-value--masked'])}>
                {masked ? mask(fields.role) : fields.role}
              </span>
            </div>
            <div className={styles['devtools__row']}>
              <span className={styles['devtools__row-label']}>EMAIL</span>
              <span className={cx(styles['devtools__row-value'], masked && styles['devtools__row-value--masked'])}>
                {masked ? mask(fields.email) : fields.email}
              </span>
            </div>
            <div className={styles['devtools__row']}>
              <span className={styles['devtools__row-label']}>Page title (hardcoded)</span>
              <span className={styles['devtools__row-value']}>User Profile</span>
            </div>
            <button
              type="button"
              className={styles['devtools__toggle']}
              onClick={() => setMasked((v) => !v)}
              aria-pressed={masked}
            >
              <span className={cx(styles['devtools__switch'], masked && styles['devtools__switch--on'])}>
                <span className={cx(styles['devtools__knob'], masked && styles['devtools__knob--on'])} />
              </span>
              {masked ? 'showing real values' : 'highlight mock data'}
            </button>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const MASCOT_SLIDES = [
  '/assets/img/morty/3.jpg',
  '/assets/img/morty/2.jpg',
  '/assets/img/morty/1.jpg',
  '/assets/img/morty/4.jpg',
];

const FADE_DURATION = 220;
const DRAG_THRESHOLD = 60;

function MascotSlider({ shouldReduce }: { shouldReduce: boolean | null }) {
  const total = MASCOT_SLIDES.length;
  const duration = shouldReduce ? 0 : FADE_DURATION;

  const [selected, setSelected] = useState(0);
  const [fading, setFading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragX, setDragX] = useState(0);

  const startXRef = useRef(0);
  const draggedRef = useRef(false);

  const leftIndex = (selected - 1 + total) % total;
  const rightIndex = (selected + 1) % total;
  const leftSrc = MASCOT_SLIDES[leftIndex];
  const rightSrc = MASCOT_SLIDES[rightIndex];
  const centerSrc = MASCOT_SLIDES[selected];

  const fadeTo = (direction: 1 | -1) => {
    if (fading) return;
    setFading(true);
    window.setTimeout(() => {
      setSelected((current) => ((current + direction) % total + total) % total);
      setFading(false);
    }, duration);
  };

  const goTo = (index: number) => {
    if (index === selected || fading) return;
    const forward = (index - selected + total) % total;
    const backward = (selected - index + total) % total;
    fadeTo(forward <= backward ? 1 : -1);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (fading) return;
    setDragging(true);
    draggedRef.current = false;
    startXRef.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const delta = e.clientX - startXRef.current;
    if (Math.abs(delta) > 4) draggedRef.current = true;
    setDragX(delta);
  };

  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    if (dragX <= -DRAG_THRESHOLD) {
      fadeTo(1);
    } else if (dragX >= DRAG_THRESHOLD) {
      fadeTo(-1);
    }
    setDragX(0);
  };

  const handleSideClick = (direction: 1 | -1) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    fadeTo(direction);
  };

  // While actively dragging, nudge opacity down as the pointer travels further,
  // without a transition, so it tracks the pointer 1:1 instead of lagging.
  const dragFeedback = dragging ? (Math.min(Math.abs(dragX), 120) / 120) * 0.4 : 0;
  const groupOpacity = fading ? 0 : 1 - dragFeedback;

  return (
    <section className={styles.mascot}>
      <div className={styles['mascot__inner']}>
        <Reveal shouldReduce={shouldReduce} className={styles['mascot__head']}>
          <div className={styles['mascot__eyebrow']}>Mascot</div>
          <h2 className={styles['mascot__title']}>This is Morty, my pug</h2>
          <p className={styles['mascot__text']}>I named this library in his honor</p>
        </Reveal>

        <Reveal shouldReduce={shouldReduce} className={styles.slider} delay={0.1}>
          <div
            className={styles['slider__stage']}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={endDrag}
          >
            <div
              className={cx(styles['slider__group'], dragging && styles['slider__group--dragging'])}
              style={{ opacity: groupOpacity }}
            >
              <button
                type="button"
                aria-label="Show previous photo"
                className={cx(styles['slider__card'], styles['slider__card--side'], styles['slider__card--left'])}
                onClick={() => handleSideClick(-1)}
              >
                <Image className={styles['slider__img']} src={leftSrc} alt="mockingpug" fill sizes="372px" draggable={false} />
              </button>

              <button
                type="button"
                aria-label="Show next photo"
                className={cx(styles['slider__card'], styles['slider__card--side'], styles['slider__card--right'])}
                onClick={() => handleSideClick(1)}
              >
                <Image className={styles['slider__img']} src={rightSrc} alt="mockingpug" fill sizes="372px" draggable={false} />
              </button>

              <div className={cx(styles['slider__card'], styles['slider__card--center'])}>
                <Image
                  className={styles['slider__img']}
                  src={centerSrc}
                  alt="mockingpug"
                  fill
                  sizes="372px"
                  priority
                  draggable={false}
                />
              </div>
            </div>
          </div>
          <div className={styles['slider__dots']}>
            {MASCOT_SLIDES.map((src, i) => (
              <button
                key={src}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                className={cx(styles['slider__dot'], i === selected && styles['slider__dot--active'])}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FinalCta({ shouldReduce }: { shouldReduce: boolean | null }) {
  return (
    <Reveal shouldReduce={shouldReduce} className={styles.cta}>
      <div className={styles['cta__card']}>
        <div className={styles['cta__eyebrow']}>Get started</div>
        <h2 className={styles['cta__title']}>Mock data easy</h2>
        <div className={styles['cta__install']}>
          <span>$</span> npm install mockingpug
        </div>
        <div className={styles['cta__actions']}>
          <Link href="/docs/getting-started" className={styles['cta__primary']}>
            Read the docs
          </Link>
          <a className={styles['cta__ghost']} href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
            View on GitHub
          </a>
        </div>
      </div>
    </Reveal>
  );
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles['footer__inner']}>
        <span>MIT licensed</span>
        <div className={styles['footer__links']}>
          <Link href="/docs" className={styles['footer__link']}>
            Docs
          </Link>
          <a className={styles['footer__link']} href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
            GitHub
          </a>
          <a
            className={styles['footer__link']}
            href="https://www.npmjs.com/package/mockingpug"
            target="_blank"
            rel="noreferrer noopener"
          >
            npm
          </a>
        </div>
      </div>
    </footer>
  );
}

function LogoMark() {
  return (
    <svg width="24" height="19" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M6.36302 7.77262C7.46199 6.94443 8.90679 6.94073 10.144 7.31532C11.3825 7.69032 12.552 8.48105 13.1838 9.44752C13.5033 9.9362 13.7003 10.4945 13.664 11.0781C13.6276 11.6621 13.3605 12.2183 12.8538 12.7027L12.8295 12.7257C12.6013 12.9397 12.3447 13.0937 12.0581 13.1669C11.7686 13.2408 11.4895 13.2218 11.2368 13.1496C11.111 13.1137 10.9903 13.0639 10.8751 13.0051C10.847 13.0383 10.8144 13.0691 10.7774 13.0964C10.3453 13.4153 9.68758 13.8116 8.99813 13.9494C8.64549 14.0199 8.24882 14.0298 7.86325 13.8935C7.46675 13.7533 7.14027 13.4789 6.90492 13.0801C6.89788 13.0682 6.89136 13.0561 6.88535 13.044C6.74299 13.0383 6.60245 12.9839 6.49416 12.881C6.26602 12.664 6.26739 12.3137 6.49723 12.0983C6.59461 12.0071 6.71305 11.8743 6.86638 11.6992C7.01221 11.5326 7.18328 11.3353 7.3639 11.1483C7.54412 10.9617 7.74951 10.7687 7.9732 10.6109C8.09233 10.5269 8.22689 10.4456 8.37505 10.3808C8.37505 10.3272 8.38337 10.2727 8.40082 10.2188C8.51837 9.85581 8.55962 9.4987 8.52165 9.09276C8.49318 8.78832 8.73162 8.51973 9.05422 8.49285C9.37682 8.46598 9.66145 8.691 9.68993 8.99545C9.73701 9.49893 9.69265 9.96371 9.55793 10.4264C9.72571 10.522 9.87968 10.6462 10.0138 10.766C10.1618 10.8984 10.3116 11.0492 10.4521 11.1913C10.597 11.3378 10.7345 11.4777 10.8746 11.6082C11.1691 11.8826 11.3977 12.0392 11.5766 12.0903C11.6509 12.1116 11.7043 12.1106 11.7517 12.0985C11.802 12.0857 11.8868 12.0495 12.003 11.9405L12.0343 11.9106C12.351 11.6023 12.4755 11.2974 12.4932 11.0132C12.5121 10.7101 12.4122 10.3751 12.1857 10.0287C11.7257 9.32492 10.8072 8.67851 9.7857 8.36923C8.76289 8.05954 7.7757 8.12443 7.09486 8.63752C6.42112 9.14526 5.86688 10.2287 6.03432 12.3447C6.05844 12.6495 5.81619 12.9151 5.49324 12.9378C5.17028 12.9606 4.88891 12.7319 4.86479 12.4272C4.68356 10.1368 5.25696 8.60617 6.36302 7.77262ZM8.92981 11.3621C8.87096 11.3797 8.78667 11.419 8.67523 11.4976C8.53657 11.5953 8.38817 11.7308 8.23064 11.8939C8.07992 12.0499 7.93514 12.216 7.78916 12.3828C7.84455 12.4257 7.8925 12.4789 7.92946 12.5415C8.04649 12.7398 8.16964 12.8199 8.2747 12.8571C8.39069 12.8981 8.54756 12.9081 8.75511 12.8666C9.1472 12.7883 9.58764 12.5528 9.94969 12.3C9.82493 12.1799 9.70477 12.0578 9.59469 11.9464C9.45079 11.8009 9.32494 11.6748 9.20726 11.5696C9.08698 11.4621 8.9999 11.3992 8.93954 11.3671C8.93603 11.3652 8.93278 11.3636 8.92981 11.3621ZM0.327273 2.33014C0.872249 1.27238 2.57028 -0.339519 5.20412 0.177328C5.52119 0.239549 5.7248 0.532558 5.65888 0.831791C5.59295 1.13103 5.28244 1.32318 4.96536 1.26096C3.02937 0.881057 1.78867 2.04224 1.39029 2.79835C1.38846 2.80426 1.38544 2.81443 1.38148 2.82977C1.37109 2.86999 1.35864 2.92755 1.34498 3.00311C1.31777 3.15358 1.28952 3.35461 1.26387 3.59043C1.21261 4.06179 1.17417 4.65018 1.17282 5.21351C1.17153 5.75481 1.2049 6.23686 1.27873 6.56618C1.3302 6.50293 1.38546 6.42653 1.44386 6.33619C1.64295 6.02823 1.84096 5.61923 2.03656 5.16764C2.23303 4.71402 2.41003 4.25859 2.5853 3.83359C2.74994 3.43432 2.92344 3.03456 3.09617 2.77714C3.26944 2.51894 3.63172 2.44217 3.90532 2.60569C4.17892 2.76921 4.26026 3.11111 4.08699 3.36932C3.98632 3.51935 3.85212 3.81331 3.67823 4.23499C3.51496 4.63092 3.32258 5.12369 3.12215 5.58644C2.92084 6.05123 2.69442 6.52684 2.445 6.91266C2.31997 7.10606 2.17969 7.29194 2.02199 7.44678C1.8671 7.59885 1.66789 7.74826 1.42039 7.82508L1.42035 7.82505C1.25292 7.87702 1.06413 7.8867 0.876227 7.82653C0.694835 7.76845 0.562388 7.66081 0.470327 7.5554C0.298723 7.35893 0.207745 7.10205 0.151756 6.88101C0.0348891 6.41964 -0.00138123 5.80508 3.99044e-05 5.21101C0.00148644 4.60657 0.0424395 3.98109 0.0972111 3.47744C0.124582 3.22575 0.156002 2.99897 0.188906 2.81697C0.2053 2.72629 0.222997 2.64145 0.242091 2.56756C0.258572 2.50377 0.284747 2.41267 0.327273 2.33014ZM12.056 0.10133C13.8486 -0.220416 15.3047 0.272207 16.3082 0.902284C16.8075 1.21574 17.2002 1.56608 17.4749 1.8754C17.6119 2.02967 17.7253 2.18023 17.8089 2.31754C17.8755 2.42684 17.9683 2.59841 17.9846 2.78265L17.986 2.80052L17.989 2.85551C18.0187 3.44155 17.9883 4.57197 17.8966 5.5453C17.8494 6.04623 17.7835 6.53338 17.6934 6.89368C17.6505 7.06524 17.5911 7.25558 17.4994 7.40804C17.4552 7.48155 17.3729 7.599 17.2317 7.68531C17.0589 7.791 16.8309 7.82705 16.6095 7.74236H16.6094C16.3911 7.65883 16.2171 7.50189 16.092 7.36977C15.9563 7.22646 15.8234 7.0524 15.6968 6.86794C15.4429 6.49828 15.18 6.03667 14.934 5.57756C14.687 5.11685 14.4476 4.64082 14.245 4.24421C14.0352 3.8334 13.8762 3.53083 13.7763 3.3779C13.6063 3.11776 13.692 2.77683 13.9676 2.6164C14.2433 2.45597 14.6045 2.53679 14.7745 2.79694C14.9137 3.00991 15.102 3.37304 15.3015 3.76367C15.5082 4.1685 15.7402 4.62967 15.9805 5.07796C16.2056 5.49806 16.4301 5.89138 16.6371 6.20129C16.6716 5.98007 16.7023 5.72394 16.7284 5.44725C16.817 4.50718 16.8437 3.43344 16.8179 2.91485C16.8124 2.90425 16.8043 2.88906 16.7921 2.86908C16.7498 2.79959 16.6789 2.70222 16.576 2.58637C16.3709 2.35545 16.0616 2.07676 15.6586 1.82379C14.8579 1.32101 13.7094 0.931215 12.2751 1.18865C11.9569 1.24575 11.6499 1.04862 11.5894 0.748362C11.5289 0.448112 11.7378 0.158433 12.056 0.10133ZM11.0802 5.00328C11.0986 4.69815 11.3756 4.46486 11.699 4.48221C12.3933 4.51947 12.8726 4.69413 13.2578 4.95279C13.4406 5.07555 13.5897 5.20899 13.7155 5.32727C13.8507 5.45436 13.9429 5.54759 14.0586 5.64653C14.2987 5.85171 14.317 6.20167 14.0996 6.4282C13.8822 6.65473 13.5114 6.67204 13.2713 6.46687C13.1578 6.36978 13.0472 6.26341 12.9553 6.17561C12.98 6.24689 12.9896 6.32395 12.9811 6.40307C12.9811 6.40622 12.9811 6.41267 12.9814 6.42334C12.9818 6.43994 12.9843 6.49732 12.984 6.54311C12.9837 6.59237 12.9809 6.6716 12.96 6.7584C12.9389 6.84575 12.8913 6.97569 12.7741 7.09168C12.5506 7.31287 12.1794 7.3212 11.9451 7.11029C11.763 6.94648 11.717 6.69859 11.8103 6.49241C11.8102 6.48901 11.8101 6.48543 11.8099 6.48153C11.8096 6.47307 11.8093 6.46319 11.809 6.45306C11.8084 6.43322 11.8079 6.40753 11.8085 6.37993C11.809 6.35262 11.8107 6.31728 11.8159 6.27816C11.8562 5.97491 12.1493 5.7599 12.4707 5.79792C12.4775 5.79872 12.4842 5.79967 12.4909 5.80069C12.3096 5.69733 12.0569 5.61 11.6324 5.58722C11.3091 5.56987 11.0619 5.30842 11.0802 5.00328ZM7.0007 4.48129C7.32455 4.48129 7.58709 4.72906 7.58709 5.0347C7.58709 5.34033 7.32455 5.5881 7.0007 5.5881C6.86669 5.5881 6.7381 5.59175 6.61434 5.59992C6.78086 5.70768 6.88388 5.8938 6.86792 6.09752C6.85239 6.29559 6.82782 6.4965 6.79956 6.68467C6.7541 6.98727 6.45733 7.19781 6.13668 7.15491C5.81603 7.11201 5.59296 6.83193 5.6384 6.52933C5.6638 6.36028 5.68511 6.18444 5.69832 6.01588C5.70602 5.91757 5.74051 5.82715 5.79452 5.75053C5.50289 5.84923 5.23809 6.0004 4.98705 6.22361C4.75134 6.4332 4.38019 6.42276 4.15811 6.20031C3.93604 5.97785 3.9471 5.62762 4.18281 5.41803C5.04076 4.65518 6.0083 4.4813 7.0007 4.48129ZM7.74718 4.95606C7.74718 4.49773 7.70996 3.9735 7.56272 3.58884C7.49069 3.40067 7.40802 3.28882 7.33298 3.22884C7.27318 3.18106 7.19183 3.14311 7.03806 3.15237C6.71487 3.17184 6.43615 2.94033 6.41552 2.63531C6.3949 2.3303 6.64018 2.06726 6.96337 2.0478C7.40569 2.02116 7.78899 2.14296 8.09088 2.38422C8.37751 2.61328 8.55358 2.91977 8.66574 3.2128C8.88688 3.79052 8.91996 4.48019 8.91996 4.95606C8.91996 5.26169 8.65742 5.50946 8.33357 5.50946C8.00973 5.50946 7.74719 5.26169 7.74718 4.95606ZM9.41319 4.95606C9.41319 4.56463 9.40675 3.91492 9.55203 3.37547C9.62499 3.10453 9.75199 2.79608 9.99619 2.55908C10.2663 2.29689 10.6344 2.167 11.0606 2.20928C11.3826 2.24124 11.6163 2.51358 11.5824 2.81754C11.5486 3.12149 11.26 3.34199 10.9379 3.31004C10.8587 3.30218 10.8491 3.31894 10.837 3.33065C10.799 3.36753 10.7393 3.46021 10.6887 3.64808C10.5868 4.02626 10.586 4.52494 10.586 4.95606C10.586 5.26169 10.3234 5.50946 9.99959 5.50946C9.67574 5.50946 9.4132 5.26169 9.41319 4.95606Z"
        fill="currentColor"
        fillOpacity="0.9"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M7 12.5A5.5 5.5 0 1 0 7 1.5a5.5 5.5 0 0 0 0 11ZM14.5 14.5 11 11"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 0C3.58 0 0 3.68 0 8.22c0 3.63 2.29 6.71 5.47 7.8.4.08.55-.18.55-.39v-1.36c-2.23.5-2.7-1.1-2.7-1.1-.36-.95-.89-1.2-.89-1.2-.72-.51.06-.5.06-.5.8.06 1.22.85 1.22.85.71 1.25 1.87.89 2.33.68.07-.53.28-.89.5-1.1-1.78-.21-3.64-.92-3.64-4.09 0-.9.31-1.64.82-2.22-.08-.21-.36-1.05.08-2.18 0 0 .67-.22 2.2.85a7.4 7.4 0 0 1 4 0c1.53-1.07 2.2-.85 2.2-.85.44 1.13.16 1.97.08 2.18.51.58.82 1.32.82 2.22 0 3.18-1.87 3.88-3.65 4.08.29.26.54.76.54 1.53v2.27c0 .21.15.47.55.39A8.24 8.24 0 0 0 16 8.22C16 3.68 12.42 0 8 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function HomeView({ githubStars }: { githubStars: number | null }) {
  const shouldReduce = useReducedMotion();

  return (
    <div className={cx(styles.page, nunito.variable, jetbrainsMono.variable)}>
      <Header githubStars={githubStars} />
      <main>
        <Hero shouldReduce={shouldReduce} />
        <HowItWorks shouldReduce={shouldReduce} />
        <Features shouldReduce={shouldReduce} />
        <FrameworkStrip />
        <DevtoolsDemo shouldReduce={shouldReduce} />
        <MascotSlider shouldReduce={shouldReduce} />
        <FinalCta shouldReduce={shouldReduce} />
      </main>
      <Footer />
    </div>
  );
}

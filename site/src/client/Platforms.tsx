import { ArrowUpRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { BRANDS, type Brand } from "./brands";
import { CliInstall } from "./CliInstall";
import { DAWN } from "./dawn";

// The tools a check starts from, as a mosaic of five large tiles: the mark, the name set large, a
// sentence and where the tile leads, one in each colour of the dawn (.tile in index.css). On a phone
// GitHub is one wide tile and the rest are two columns of marks and names.

const DOCS = "https://github.com/t1dem/proofed/blob/main/docs";

type TileProps = { brand: Brand; name: string; does: string; fill: string; href: string; go: string; className?: string; children?: ReactNode };

const go = "inline-flex items-center gap-1.5 text-[15px] font-semibold";

function Tile({ brand, name, does, fill, href, go: label, className = "", children }: TileProps) {
  return (
    <div
      style={{ "--fill": fill } as CSSProperties}
      className={`tile group relative flex min-h-[132px] flex-col rounded-2xl p-4 transition-[filter] duration-200 hover:brightness-105 sm:rounded-3xl sm:p-6 xl:p-8 ${className}`}
    >
      {/* The whole tile is the link; what a tile can do on its own (the CLI's copy button) sits above it. */}
      <a href={href} aria-label={`${name}: ${does}`} className="absolute inset-0 rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70" />
      <svg viewBox="0 0 24 24" aria-hidden className="size-10 fill-current sm:size-12 xl:size-16">
        <path d={BRANDS[brand]} />
      </svg>
      <p className="mt-auto pt-4 text-[21px] font-semibold leading-none tracking-[-0.03em] sm:text-[28px] xl:text-[40px]">{name}</p>
      <p className="mt-3 text-[15px] leading-snug text-black/65 max-sm:hidden">{does}</p>
      <div className="mt-5 max-sm:hidden">
        {children ?? (
          <span className={go}>
            {label} <ArrowUpRight aria-hidden size={16} strokeWidth={2.25} />
          </span>
        )}
      </div>
    </div>
  );
}

const tall = "sm:col-span-2 sm:min-h-[240px] xl:min-h-[340px]";
const wide = "sm:col-span-3 sm:min-h-[200px] xl:min-h-[272px]";

export function Platforms() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 className="max-w-4xl text-[2.2rem] sm:text-balance font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl">
          Works with what you already use. <span className="text-faint">From your tools to the real app.</span>
        </h2>

        <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Tile brand="github" name="GitHub" does="The App and the Action check every pull request and post the report on it." fill={DAWN.paper} href="/install" go="Install on GitHub" className={`max-sm:col-span-2 ${tall}`} />

          {/* z-10: the menu of package managers opens over the tile below. */}
          <Tile brand="npm" name="CLI" does="The same check on your machine, before you push." fill={DAWN.sand} href="https://www.npmjs.com/package/proofed-cli" go="proofed-cli on npm" className={`z-10 ${tall}`}>
            {/* The command needs the tile's full width on a wide screen; narrower, the tile leads to npm. */}
            <div className="relative z-10 inline-block text-fg max-xl:hidden">
              <CliInstall />
            </div>
            <span className={`${go} xl:hidden`}>
              proofed-cli on npm <ArrowUpRight aria-hidden size={16} strokeWidth={2.25} />
            </span>
          </Tile>

          <Tile brand="mcp" name="MCP server" does="A check tool for any agent." fill={DAWN.gold} href={`${DOCS}/cli.md#mcp-and-the-claude-code-stop-hook`} go="Docs" className={tall} />

          <Tile brand="claude" name="Claude Code" does="Writes fixes. Its Stop hook runs a check at the end of a turn." fill={DAWN.clay} href={`${DOCS}/cli.md#mcp-and-the-claude-code-stop-hook`} go="Docs" className={wide} />
          <Tile brand="openai" name="Codex" does="Writes fixes with your OpenAI key." fill={DAWN.blue} href={`${DOCS}/setup.md`} go="Docs" className={wide} />
        </div>
      </div>
    </section>
  );
}

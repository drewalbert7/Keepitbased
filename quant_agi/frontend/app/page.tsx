import { CodeDiffPanel } from "../components/CodeDiffPanel";
import { EventTimeline } from "../components/EventTimeline";
import { JarvisCodingChat } from "../components/JarvisCodingChat";
import { MarketTape } from "../components/MarketTape";
import { MetricsPanel } from "../components/MetricsPanel";
import { MissionBanner } from "../components/MissionBanner";
import { StreamBootstrap } from "../components/StreamBootstrap";
import { TerminalHeader } from "../components/TerminalHeader";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-bg px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <MissionBanner />
        <TerminalHeader />
        <StreamBootstrap />
        <MarketTape />
        <section className="grid gap-4 lg:grid-cols-[1.1fr_1fr_0.9fr]">
          <EventTimeline />
          <div className="flex min-w-0 flex-col gap-4">
            <JarvisCodingChat />
            <CodeDiffPanel />
          </div>
          <MetricsPanel />
        </section>
      </div>
    </main>
  );
}

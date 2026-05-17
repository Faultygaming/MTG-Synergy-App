import { DeckPasteForm } from "@/components/DeckPasteForm";

export default function NewDeckPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-2xl font-bold">New deck</h1>
        <p className="mt-1 text-sm text-stone-400">
          Paste your decklist below. One card per line — &ldquo;4 Lightning Bolt&rdquo;
          and &ldquo;4x Lightning Bolt&rdquo; both work. Set codes after the name are
          ignored.
        </p>
      </header>
      <DeckPasteForm />
    </main>
  );
}

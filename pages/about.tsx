import Head from "next/head";
import Link from "next/link";

export default function About() {
  return (
    <>
      <Head>
        <title>Über teilaustritt.ch</title>
      </Head>
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="mb-6 text-3xl font-bold">Über uns</h1>
        <p className="mb-4">
          teilaustritt.ch ist ein ehrenamtliches Projekt, das katholischen
          Christinnen und Christen in der Schweiz ermöglicht, weiterhin ihren
          Glauben zu leben, ohne Teil des dualen Systems zu sein.
        </p>
        <Link href="/" className="text-indigo-600 hover:underline">
          Zurück zur Startseite
        </Link>
      </main>
    </>
  );
}

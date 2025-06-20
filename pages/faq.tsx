import Head from "next/head";
import Link from "next/link";

export default function Faq() {
  return (
    <>
      <Head>
        <title>FAQ – teilaustritt.ch</title>
      </Head>
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="mb-6 text-3xl font-bold">Häufige Fragen</h1>
        <ul className="space-y-6">
          <li>
            <h2 className="text-xl font-semibold">
              Muss ich nach dem Austritt auf Sakramente verzichten?
            </h2>
            <p className="text-gray-600">
              Nein. Der Austritt betrifft nur die staatlich anerkannte
              Kirchenstruktur – nicht die Zugehörigkeit zur Weltkirche.
            </p>
          </li>
          {/* Weitere Fragen hier ergänzen */}
        </ul>
        <Link href="/" className="mt-10 inline-block text-indigo-600 hover:underline">
          Zurück zur Startseite
        </Link>
      </main>
    </>
  );
}

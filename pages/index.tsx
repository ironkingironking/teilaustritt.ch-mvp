import Head from "next/head";
import Link from "next/link";

export default function Home() {
  return (
    <>
      <Head>
        <title>teilaustritt.ch – Weiter katholisch, ohne Kirchensteuer</title>
        <meta
          name="description"
          content="Automatisiere dein Austrittsschreiben aus Kirchgemeinde und Landeskirche in der Schweiz – bleib katholisch, ohne Kirchensteuer."
        />
      </Head>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <h1 className="mb-6 text-center text-4xl font-extrabold leading-tight text-gray-900 sm:text-5xl">
          Weiter katholisch bleiben <br className="hidden sm:block" />
          <span className="text-indigo-600">ohne Kirchensteuer.</span>
        </h1>
        <p className="mb-8 max-w-xl text-center text-lg text-gray-600">
          Erstelle dein individuelles Austrittsschreiben in weniger als&nbsp;2&nbsp;Minuten.
        </p>
        <Link
          className="rounded-2xl bg-indigo-600 px-8 py-3 text-lg font-semibold text-white shadow-lg transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300"
          href="/exit"
        >
          Austritt starten
        </Link>
      </main>
    </>
  );
}

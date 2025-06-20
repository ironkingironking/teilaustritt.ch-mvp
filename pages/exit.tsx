import { useState } from "react";
import Head from "next/head";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import jsPDF from "jspdf";
import data from "@/data/kirchgemeinden.json";

type FormData = {
  firstName: string;
  lastName: string;
  street: string;
  zip: string;
  city: string;
  parishId: string;
};

const schema = yup.object({
  firstName: yup.string().required("Vorname ist erforderlich"),
  lastName: yup.string().required("Nachname ist erforderlich"),
  street: yup.string().required("Adresse ist erforderlich"),
  zip: yup.string().required("PLZ ist erforderlich"),
  city: yup.string().required("Ort ist erforderlich"),
  parishId: yup.string().required("Kirchgemeinde wählen"),
});

export default function ExitForm() {
  const [step, setStep] = useState<"form" | "preview" | "done">("form");

  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<FormData>({
    resolver: yupResolver(schema),
  });

  const onSubmit = () => {
    setStep("preview");
  };

  const generatePdf = () => {
    const values = getValues();
    const parish = (data as any[]).find((p) => p.id === values.parishId);
    const doc = new jsPDF();
    doc.text("Austrittsschreiben", 10, 10);
    doc.text(`${values.firstName} ${values.lastName}`, 10, 20);
    doc.text(values.street, 10, 30);
    doc.text(`${values.zip} ${values.city}`, 10, 40);
    if (parish) {
      doc.text(`An ${parish.kirchgemeinde}`, 10, 60);
      doc.text(parish.anschrift, 10, 70);
    }
    doc.text("Hiermit erkläre ich meinen Austritt...", 10, 90);
    doc.save("austritt.pdf");
    setStep("done");
  };

  return (
    <>
      <Head>
        <title>Austritt starten – teilaustritt.ch</title>
      </Head>
      <main className="mx-auto max-w-2xl px-4 py-12">
        {step === "form" && (
          <>
            <h1 className="mb-6 text-2xl font-bold">Austrittsschreiben erstellen</h1>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium">Vorname</label>
                <input
                  className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                  {...register("firstName")}
                />
                {errors.firstName && (
                  <p className="text-sm text-red-600">{errors.firstName.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium">Nachname</label>
                <input
                  className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                  {...register("lastName")}
                />
                {errors.lastName && (
                  <p className="text-sm text-red-600">{errors.lastName.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium">Adresse</label>
                <input
                  className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                  {...register("street")}
                />
                {errors.street && (
                  <p className="text-sm text-red-600">{errors.street.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium">PLZ</label>
                <input
                  className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                  {...register("zip")}
                />
                {errors.zip && <p className="text-sm text-red-600">{errors.zip.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium">Ort</label>
                <input
                  className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                  {...register("city")}
                />
                {errors.city && (
                  <p className="text-sm text-red-600">{errors.city.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium">Kirchgemeinde</label>
                <select
                  className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                  {...register("parishId")}
                >
                  <option value="">Bitte wählen</option>
                  {(data as any[]).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.kanton} – {p.kirchgemeinde}
                    </option>
                  ))}
                </select>
                {errors.parishId && (
                  <p className="text-sm text-red-600">{errors.parishId.message}</p>
                )}
              </div>
              <div className="pt-4">
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-6 py-3 text-white hover:bg-indigo-700"
                >
                  Vorschau
                </button>
              </div>
            </form>
          </>
        )}
        {step === "preview" && (
          <>
            <h1 className="mb-6 text-2xl font-bold">Vorschau</h1>
            <pre className="mb-4 rounded-md bg-gray-100 p-4 text-sm">
              {JSON.stringify(getValues(), null, 2)}
            </pre>
            <button
              onClick={generatePdf}
              className="mr-4 rounded-xl bg-indigo-600 px-6 py-3 text-white hover:bg-indigo-700"
            >
              PDF herunterladen
            </button>
            <button
              onClick={() => setStep("form")}
              className="rounded-xl bg-gray-200 px-6 py-3 hover:bg-gray-300"
            >
              Zurück
            </button>
          </>
        )}
        {step === "done" && (
          <>
            <h1 className="mb-6 text-2xl font-bold">Alles erledigt!</h1>
            <p className="mb-6 text-gray-600">
              Dein Austrittsschreiben wurde generiert.
            </p>
          </>
        )}
      </main>
    </>
  );
}

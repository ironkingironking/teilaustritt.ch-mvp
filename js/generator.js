document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('form-generator');
  const template = document.getElementById('letter-template');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());

    let letterHTML = template.innerHTML
      .replaceAll('{DATUM}', new Intl.DateTimeFormat('de-CH').format(new Date()))
      .replaceAll('{VORNAME}', data.vorname.trim())
      .replaceAll('{NACHNAME}', data.nachname.trim())
      .replaceAll('{STRASSE}', data.strasse.trim())
      .replaceAll('{PLZ}', data.plz.trim())
      .replaceAll('{ORT}', data.ort.trim());

    const letterElem = document.createElement('div');
    letterElem.innerHTML = letterHTML;
    document.body.appendChild(letterElem);

    html2pdf().from(letterElem).toPdf().get('pdf').then(pdf => {
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      URL.revokeObjectURL(url);
      document.body.removeChild(letterElem);
    });
  });
});
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('form-generator');
  const template = document.getElementById('letter-template');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = Object.fromEntries(new FormData(form).entries());

    // Replace placeholders in template
    let letterHTML = template.innerHTML
      .replaceAll('{DATUM}', new Intl.DateTimeFormat('de-CH').format(new Date()))
      .replaceAll('{VORNAME}', data.vorname.trim())
      .replaceAll('{NACHNAME}', data.nachname.trim())
      .replaceAll('{STRASSE}', data.strasse.trim())
      .replaceAll('{PLZ}', data.plz.trim())
      .replaceAll('{ORT}', data.ort.trim());

    // Create temporary element to convert
    const letterElem = document.createElement('div');
    letterElem.innerHTML = letterHTML;
    document.body.appendChild(letterElem);

    // Generate PDF
    await html2pdf().from(letterElem).set({
      margin: [15, 20],
      pagebreak: { mode: ['avoid-all'] },
      filename: `teilaustritt_${data.nachname}.pdf`
    }).save();

    // Cleanup
    document.body.removeChild(letterElem);
  });
});

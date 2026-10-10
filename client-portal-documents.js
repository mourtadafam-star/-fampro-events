// The portal uses the signed-in Supabase session. RLS is the final ownership check.
(function () {
  const previousLoadPortal = loadPortal;
  const documentStyle = document.createElement('style');
  documentStyle.textContent = '.portal-document-button{display:inline-flex;align-items:center;justify-content:center;margin-top:11px;padding:9px 12px;border:0;border-radius:9px;background:var(--red);color:#fff;font:inherit;font-size:13px;font-weight:800;cursor:pointer}.portal-document-button:disabled{opacity:.6;cursor:wait}.portal-document-note{display:block;margin-top:8px;color:var(--muted);font-size:12px}.portal-document-error{color:#b00020}.portal-card small{display:block;margin-top:5px}@media(max-width:700px){.portal-document-button{min-height:44px;width:100%}}';
  document.head.append(documentStyle);

  const invoiceById = new Map();
  const reservationById = new Map();
  let ownProfile = null;
  let portalLoadSequence = 0;
  const currency = value => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} FCFA`;
  const readableDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('fr-FR') : 'À confirmer';
  const pdfText = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u00a0\u202f]/g, ' ').replace(/[–—]/g, '-');

  function makeCard(title, lines) {
    const card = document.createElement('div');
    card.className = 'portal-card';
    const heading = document.createElement('b');
    heading.textContent = title;
    card.append(heading);
    lines.forEach(line => {
      const detail = document.createElement('small');
      detail.textContent = line;
      card.append(detail);
    });
    return card;
  }

  function renderDocuments(reservations, invoices) {
    const columns = [...document.querySelectorAll('#portal-content .portal-grid>div')];
    const reservationColumn = columns.find(column => column.querySelector('h3')?.textContent.trim() === 'Mes réservations');
    const invoiceColumn = columns.find(column => column.querySelector('h3')?.textContent.trim() === 'Mes factures');
    if (!reservationColumn || !invoiceColumn) return;
    reservationColumn.querySelectorAll('.portal-card,.sub').forEach(element => element.remove());
    invoiceColumn.querySelectorAll('.portal-card,.sub').forEach(element => element.remove());
    invoiceById.clear();
    reservationById.clear();
    const issuedReservationIds = new Set(invoices.map(invoice => String(invoice.reservation_id)));

    if (!reservations.length) {
      const empty = document.createElement('p');
      empty.className = 'sub';
      empty.textContent = 'Aucune réservation pour le moment.';
      reservationColumn.append(empty);
    }
    reservations.forEach(reservation => {
      reservationById.set(String(reservation.id), reservation);
      const card = makeCard(`${reservation.type_evenement || 'Événement'} · ${readableDate(reservation.date_evenement)}`, [
        `Lieu : ${reservation.lieu || 'À confirmer'} · Statut : ${reservation.statut || 'En attente'}`,
        `Montant : ${currency(reservation.montant_total)} · Déjà payé : ${currency(reservation.montant_paye)}`
      ]);
      if (!issuedReservationIds.has(String(reservation.id))) {
        const note = document.createElement('span');
        note.className = 'portal-document-note';
        note.textContent = 'Facture en préparation : elle apparaîtra ici après son émission par FAMpro.';
        card.append(note);
      }
      if (/confirm/i.test(String(reservation.statut || '')) && reservation.date_evenement) {
        const start = reservation.date_evenement.replaceAll('-', '');
        const endDate = new Date(`${reservation.date_evenement}T12:00:00`);
        endDate.setDate(endDate.getDate() + 1);
        const end = endDate.toISOString().slice(0, 10).replaceAll('-', '');
        const link = document.createElement('a');
        link.className = 'portal-calendar';
        link.target = '_blank';
        link.rel = 'noopener';
        link.href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`FAMpro Évents — ${reservation.type_evenement || 'Réservation'}`)}&dates=${start}/${end}&location=${encodeURIComponent(reservation.lieu || '')}`;
        link.textContent = 'Ajouter à mon calendrier';
        card.append(link);
      }
      reservationColumn.append(card);
    });

    if (!invoices.length) {
      const empty = document.createElement('p');
      empty.className = 'sub';
      empty.textContent = 'Aucune facture émise pour le moment.';
      invoiceColumn.append(empty);
    }
    invoices.forEach(invoice => {
      const reservation = reservationById.get(String(invoice.reservation_id));
      if (!reservation) return;
      invoiceById.set(String(invoice.id), invoice);
      const card = makeCard(`Facture ${invoice.numero || 'en cours'}`, [
        `${reservation.type_evenement || 'Événement'} · ${readableDate(reservation.date_evenement)}`,
        `${currency(invoice.montant_total)} · ${invoice.statut || 'Émise'}`
      ]);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'portal-document-button';
      button.dataset.invoiceId = String(invoice.id);
      button.textContent = 'Télécharger la facture PDF';
      card.append(button);
      invoiceColumn.append(card);
    });
  }

  function invoicePdf(invoice, reservation, profile) {
    const Pdf = window.jspdf?.jsPDF;
    if (!Pdf) throw new Error('Le module PDF est indisponible. Vérifiez votre connexion puis réessayez.');
    const pdf = new Pdf({ unit: 'mm', format: 'a4' });
    const drawHeader = () => {
      pdf.setFillColor(166, 7, 19);
      pdf.rect(0, 0, 210, 42, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(19);
      pdf.text('FAMpro Events', 18, 19);
      pdf.setFontSize(9);
      pdf.text('Nous creons, vous celebrez.', 18, 27);
      pdf.setFontSize(16);
      pdf.text('FACTURE', 192, 19, { align: 'right' });
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text(pdfText(invoice.numero || ''), 192, 27, { align: 'right' });
      pdf.setTextColor(30, 32, 36);
    };
    drawHeader();
    pdf.setFontSize(10);
    pdf.text(`Date : ${readableDate(invoice.date_facture)}`, 18, 52);
    pdf.text('FAMpro Events  |  +221 77 287 52 52  |  mourtadafam@gmail.com', 18, 59);
    pdf.setDrawColor(226, 218, 220);
    pdf.line(18, 64, 192, 64);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text('CLIENT', 18, 75);
    pdf.text('RESERVATION', 108, 75);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(pdfText(profile?.nom || 'Client'), 18, 83);
    pdf.text(pdfText(profile?.telephone || ''), 18, 89);
    pdf.text(pdfText(reservation.type_evenement || 'Evenement'), 108, 83);
    pdf.text(`${readableDate(reservation.date_evenement)} - ${pdfText(reservation.lieu || 'Lieu a confirmer')}`, 108, 89, { maxWidth: 84 });
    let y = 105;
    const items = Array.isArray(reservation.materiel_reserve) ? reservation.materiel_reserve.filter(item => Number(item.quantite) > 0) : [];
    if (items.length) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text('Materiel reserve', 18, y);
      y += 9;
      pdf.setFontSize(9);
      items.forEach(item => {
        if (y > 218) { pdf.addPage(); drawHeader(); y = 55; }
        pdf.setFont('helvetica', 'normal');
        const nameLines = pdf.splitTextToSize(pdfText(item.nom || 'Materiel'), 130);
        pdf.text(nameLines, 18, y);
        pdf.text(`${Number(item.quantite)} ${pdfText(item.unite || 'unite')}`, 192, y, { align: 'right' });
        y += Math.max(7, nameLines.length * 5);
      });
      y += 5;
    }
    if (y > 225) { pdf.addPage(); drawHeader(); y = 55; }
    pdf.setDrawColor(226, 218, 220);
    pdf.line(18, y, 192, y);
    y += 11;
    pdf.setFontSize(10);
    [['Montant total', invoice.montant_total], ['Deja paye', reservation.montant_paye], ['Reste a payer', Math.max(0, Number(invoice.montant_total || 0) - Number(reservation.montant_paye || 0))]].forEach(([label, amount], index) => {
      pdf.setFont('helvetica', index === 2 ? 'bold' : 'normal');
      pdf.text(label, 18, y);
      pdf.text(currency(amount).replace(/[\u00a0\u202f]/g, ' '), 192, y, { align: 'right' });
      y += 9;
    });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text('Paiement : Wave ou Orange Money au +221 77 287 52 52, ou especes.', 18, Math.min(y + 8, 264));
    pdf.setFontSize(8);
    pdf.setTextColor(100, 102, 108);
    pdf.text('FAMpro Events - Location de materiel evenementiel', 18, 282);
    return pdf;
  }

  loadPortal = async function () {
    const sequence = ++portalLoadSequence;
    await previousLoadPortal();
    if (portalHome.hidden) return;
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user || sequence !== portalLoadSequence) return;
    const [profileResult, reservationsResult, invoicesResult] = await Promise.all([
      client.from('clients').select('id,nom,telephone').eq('auth_user_id', user.id).maybeSingle(),
      client.from('reservations').select('id,client_id,type_evenement,date_evenement,lieu,montant_total,montant_paye,statut,materiel_reserve,created_at').order('created_at', { ascending: false }),
      client.from('factures').select('id,reservation_id,numero,date_facture,montant_total,statut,created_at').order('created_at', { ascending: false })
    ]);
    if (sequence !== portalLoadSequence) return;
    if (profileResult.error || reservationsResult.error || invoicesResult.error) {
      const message = document.createElement('p');
      message.className = 'message error';
      message.textContent = 'Impossible de charger vos réservations et factures. Réessayez plus tard.';
      document.querySelector('#portal-content')?.append(message);
      return;
    }
    ownProfile = profileResult.data;
    // Explicit client-ID filtering complements, but never replaces, Supabase RLS.
    const ownReservations = (reservationsResult.data || []).filter(row => ownProfile && String(row.client_id) === String(ownProfile.id));
    const ownIds = new Set(ownReservations.map(row => String(row.id)));
    const ownInvoices = (invoicesResult.data || []).filter(row => ownIds.has(String(row.reservation_id)));
    renderDocuments(ownReservations, ownInvoices);
  };

  document.querySelector('#portal-content').addEventListener('click', event => {
    const button = event.target.closest('[data-invoice-id]');
    if (!button) return;
    const invoice = invoiceById.get(button.dataset.invoiceId);
    const reservation = invoice && reservationById.get(String(invoice.reservation_id));
    if (!invoice || !reservation) return;
    button.disabled = true;
    const label = button.textContent;
    button.textContent = 'Préparation du PDF…';
    try {
      const pdf = invoicePdf(invoice, reservation, ownProfile);
      const fileName = `FAMpro-Facture-${String(invoice.numero || invoice.id).replace(/[^a-z0-9-]/gi, '-')}.pdf`;
      pdf.save(fileName);
    } catch (error) {
      const message = document.createElement('small');
      message.className = 'portal-document-error';
      message.textContent = error.message || 'Impossible de créer le PDF.';
      button.insertAdjacentElement('afterend', message);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
  client.auth.getSession().then(({ data }) => {
    if (data.session) loadPortal();
  }).catch(() => {});
}());

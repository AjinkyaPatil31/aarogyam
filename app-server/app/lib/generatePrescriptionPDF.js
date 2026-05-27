// PDF Prescription Generator
// Uses jsPDF to create a formatted prescription PDF
// Leaves 4cm blank at top and 4cm at bottom for 
// physical letterhead paper

import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

export function generatePrescriptionPDF(record, patientName) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // A4 dimensions: 210mm x 297mm
  const pageWidth = 210;
  const pageHeight = 297;
  const marginLeft = 15;
  const marginRight = 15;
  const contentWidth = pageWidth - marginLeft - marginRight;
  
  // 4cm = 40mm blank at top for physical letterhead
  // 4cm = 40mm blank at bottom for physical letterhead
  let y = 45; // start content at 45mm from top
  const bottomLimit = pageHeight - 45; // stop at 252mm

  // ── Helper functions ──
  function checkPageBreak(neededSpace = 10) {
    if (y + neededSpace > bottomLimit) {
      doc.addPage();
      y = 45;
    }
  }

  function drawSectionHeader(text) {
    checkPageBreak(12);
    doc.setFillColor(241, 245, 249); // slate-100
    doc.roundedRect(marginLeft, y, contentWidth, 7, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105); // slate-600
    doc.text(text.toUpperCase(), marginLeft + 3, y + 4.5);
    y += 10;
  }

  function drawKeyValue(key, value, x, colWidth) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(key, x, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59); // slate-800
    const lines = doc.splitTextToSize(String(value || '—'), colWidth - 2);
    doc.text(lines, x, y + 4);
    return lines.length * 4 + 2;
  }

  function drawDivider() {
    checkPageBreak(5);
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.3);
    doc.line(marginLeft, y, pageWidth - marginRight, y);
    y += 4;
  }

  // ══════════════════════════════════════════
  // SECTION 1 — Patient & Visit Info ribbon
  // ══════════════════════════════════════════
  doc.setFillColor(248, 250, 252); // slate-50
  doc.roundedRect(marginLeft, y, contentWidth, 18, 2, 2, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(marginLeft, y, contentWidth, 18, 2, 2, 'S');

  // Patient name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text(patientName, marginLeft + 4, y + 7);

  // Date right aligned
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const dateText = `Date: ${record.consultationDate}`;
  doc.text(dateText, pageWidth - marginRight - 4, y + 7, { align: 'right' });

  // Diagnosis below name
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Dx: ${record.diagnosis}`, marginLeft + 4, y + 13);

  y += 22;

  // ══════════════════════════════════════════
  // SECTION 2 — Clinical Notes
  // ══════════════════════════════════════════
  drawSectionHeader('Clinical Notes');
  
  // Symptoms
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('SYMPTOMS', marginLeft, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(8.5);
  const symptomLines = doc.splitTextToSize(record.symptoms || '—', contentWidth);
  doc.text(symptomLines, marginLeft, y);
  y += symptomLines.length * 4 + 4;
  checkPageBreak(8);

  // ══════════════════════════════════════════
  // SECTION 3 — Vital Signs
  // ══════════════════════════════════════════
  drawSectionHeader('Vital Signs');

  const vitalsData = [
    ['Blood Pressure', record.bloodPressure ? `${record.bloodPressure} mmHg` : '—'],
    ['Heart Rate', record.heartRate ? `${record.heartRate} bpm` : '—'],
    ['Temperature', record.temperature ? `${record.temperature} °F` : '—'],
    ['SpO2', record.spo2 ? `${record.spo2}%` : '—'],
    ['Weight', record.weight ? `${record.weight} kg` : '—'],
    ['Respiratory Rate', record.respiratoryRate ? `${record.respiratoryRate} /min` : '—'],
  ];

  // 3-column grid for vitals
  const colW = contentWidth / 3;
  vitalsData.forEach((vital, i) => {
    const col = i % 3;
    const x = marginLeft + col * colW;
    if (col === 0 && i > 0) {
      y += 12;
      checkPageBreak(12);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(vital[0], x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(vital[1], x, y + 5);
  });
  y += 14;

  // ══════════════════════════════════════════
  // SECTION 4 — System Examinations (if any)
  // ══════════════════════════════════════════
  const hasExams = record.rsExam || record.cvsExam || 
                   record.cnsExam || record.paExam;
  if (hasExams) {
    checkPageBreak(20);
    drawSectionHeader('System Examinations');
    const exams = [
      { label: 'RS (Respiratory System)', status: record.rsExam, note: record.rsNote },
      { label: 'CVS (Cardiovascular System)', status: record.cvsExam, note: record.cvsNote },
      { label: 'CNS (Central Nervous System)', status: record.cnsExam, note: record.cnsNote },
      { label: 'PA (Physical Appearance)', status: record.paExam, note: record.paNote },
    ].filter(e => e.status);

    // Track row-max height for 2-column grid so notes don't overlap next row
    let rowHeight = 0;
    exams.forEach((exam, i) => {
      const col = i % 2;
      const x = marginLeft + col * (contentWidth / 2);
      const examWidth = contentWidth / 2 - 4;

      // Start of a new row: advance y by the previous row's max height
      if (col === 0 && i > 0) {
        y += rowHeight;
        checkPageBreak(rowHeight);
        rowHeight = 0;
      }

      // Label
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(exam.label, x, y);

      // Status badge
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(exam.status === 'Normal' ? 22 : 163, 
                       exam.status === 'Normal' ? 163 : 28, 
                       exam.status === 'Normal' ? 74 : 28);
      doc.text(exam.status, x, y + 5);

      // Notes text (if any) — safely wrapped to avoid overflow
      let noteLineCount = 0;
      if (exam.note && exam.note.trim()) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        const noteLines = doc.splitTextToSize(exam.note.trim(), examWidth);
        doc.text(noteLines, x, y + 10);
        noteLineCount = noteLines.length;
      }

      // Track the tallest item in this row (label 4mm + badge 4mm + notes)
      const itemHeight = 10 + noteLineCount * 4;
      if (itemHeight > rowHeight) rowHeight = itemHeight;
    });
    // Advance past the last row
    y += rowHeight + 4;
  }

  // ══════════════════════════════════════════
  // SECTION 5 — General Assessment (if any)
  // ══════════════════════════════════════════
  const assessmentItems = [
    record.allergy && `Allergy${record.allergyNote ? ': ' + record.allergyNote : ''}`,
    record.edema && `Edema${record.edemaNote ? ': ' + record.edemaNote : ''}`,
    record.clubbing && 'Clubbing',
    record.icterus && 'Icterus',
    record.pallor && 'Pallor',
  ].filter(Boolean);

  if (assessmentItems.length > 0) {
    checkPageBreak(15);
    drawSectionHeader('General Assessment');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);
    doc.text(assessmentItems.join('  ·  '), marginLeft, y);
    y += 8;
  }

  // ══════════════════════════════════════════
  // SECTION 6 — Medical History (if any)
  // ══════════════════════════════════════════
  const historyItems = [
    record.historyDM && 'DM',
    record.historyHTN && 'HTN',
    record.historyIHD && 'IHD',
    record.historyCVA && 'CVA',
    record.historyCKD && 'CKD',
    record.historyHypothyroid && 'HYPOTHYROID',
    record.historyCOPD && 'COPD/BA',
  ].filter(Boolean);

  if (historyItems.length > 0) {
    checkPageBreak(15);
    drawSectionHeader('Medical History');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(185, 28, 28); // red-700
    doc.text(historyItems.join('   '), marginLeft, y);
    y += 8;
  }

  // ══════════════════════════════════════════
  // SECTION 7 — Prescription (Rx)
  // ══════════════════════════════════════════
  if (record.prescriptions?.length > 0) {
    checkPageBreak(20);
    drawSectionHeader('Rx — Prescribed Medications');

    // Table header
    const cols = {
      num: marginLeft,
      name: marginLeft + 6,
      dosage: marginLeft + 70,
      freq: marginLeft + 100,
      duration: marginLeft + 130,
      instructions: marginLeft + 155,
    };

    doc.setFillColor(226, 232, 240);
    doc.rect(marginLeft, y, contentWidth, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text('#', cols.num, y + 4);
    doc.text('MEDICATION', cols.name, y + 4);
    doc.text('DOSAGE', cols.dosage, y + 4);
    doc.text('FREQUENCY', cols.freq, y + 4);
    doc.text('DURATION', cols.duration, y + 4);
    doc.text('INSTRUCTIONS', cols.instructions, y + 4);
    y += 7;

    record.prescriptions.forEach((rx, i) => {
      checkPageBreak(8);
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(marginLeft, y - 1, contentWidth, 7, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(30, 41, 59);
      doc.text(String(i + 1), cols.num, y + 4);
      doc.setFont('helvetica', 'bold');
      doc.text(rx.medicationName, cols.name, y + 4);
      doc.setFont('helvetica', 'normal');
      doc.text(rx.dosage, cols.dosage, y + 4);
      doc.text(rx.frequency, cols.freq, y + 4);
      doc.text(rx.duration, cols.duration, y + 4);
      if (rx.instructions) {
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(rx.instructions, cols.instructions, y + 4);
      }
      y += 7;
    });
    y += 3;
  }

  // ══════════════════════════════════════════
  // SECTION 8 — Special Instructions / Advice
  // ══════════════════════════════════════════
  const notesText = record.specialInstructions || record.instructions || record.advice || record.notes;

  if (notesText && notesText.trim() !== '') {
    checkPageBreak(20);
    y += 12; // Advance spacing down from the preceding section safely

    // Render section heading
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.text('SPECIAL INSTRUCTIONS / ADVICE', 14, y);

    y += 6; // Space between title and description body

    // Render the instruction body text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105); // Slate-600

    // Wrap long text strings inside the standard document printable width margin boundaries
    const splitInstructions = doc.splitTextToSize(notesText.trim(), 182);
    doc.text(splitInstructions, 14, y);

    // Increment y by the total height consumed by the text block lines
    y += (splitInstructions.length * 5);
  }

  // ══════════════════════════════════════════
  // SECTION 9 — Doctor signature block
  // ══════════════════════════════════════════
  let doctorEmail = record.doctor?.email || record.doctorEmail;

  if (!doctorEmail && typeof window !== 'undefined') {
    try {
      const token = window.localStorage.getItem('aarogyam_token');
      if (token) {
        // Safe base64 decode of the JWT payload to grab the logged-in user's email string
        const payloadBase64 = token.split('.')[1];
        const decoded = JSON.parse(window.atob(payloadBase64));
        if (decoded && decoded.email) {
          doctorEmail = decoded.email;
        }
      }
    } catch (e) {
      console.error("Failed to parse doctor session for PDF:", e);
    }
  }

  // Ensure enough room for the full signature block (line + stamp gap + name + date ≈ 25mm)
  checkPageBreak(25);

  // Anchor signature position relative to the last content block (y), falling back
  // to the standard near-bottom position (52mm from page foot) when there's room.
  // This keeps the layout intact on short documents but follows content downward
  // on long-running multi-page documents without overlap.
  const sigY = Math.max(pageHeight - 52, y + 10);

  // Space label above line
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    '(Signature)',
    pageWidth - marginRight,
    sigY - 2,
    { align: 'right' }
  );

  // Signature line
  doc.setDrawColor(30, 41, 59);
  doc.setLineWidth(0.4);
  doc.line(
    pageWidth - marginRight - 55,
    sigY,
    pageWidth - marginRight,
    sigY
  );

  // Doctor User ID below line (15mm padding for ink signature / stamp)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text(
    `Dr. ${doctorEmail}`,
    pageWidth - marginRight,
    sigY + 15,
    { align: 'right' }
  );

  // Date below doctor name
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    record.consultationDate,
    pageWidth - marginRight,
    sigY + 20,
    { align: 'right' }
  );

  return doc;
}

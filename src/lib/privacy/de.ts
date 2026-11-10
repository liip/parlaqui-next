import type { Privacy } from './index';

export const de: Privacy = {
	title: 'Datenschutz',
	intro:
		'Parlaqui spielst du ohne Konto, ohne Namen und ohne E-Mail-Adresse. Diese Seite erklärt, was die Website speichert, wozu und wie lange.',
	sections: [
		{
			title: 'Wer verantwortlich ist',
			paragraphs: [
				'Parlaqui wird von der Liip AG, Rue de la Banque 1, 1701 Freiburg, Schweiz, betrieben. Bei Fragen zu deinen Daten: contact@liip.ch.'
			]
		},
		{
			title: 'Was wir speichern',
			paragraphs: [
				'Ein Spiel-Cookie (pq.visitor): eine zufällige Kennung, die deine Spiele mit diesem Browser verbindet, damit ein laufendes Spiel weitergeht und dein Rekord, dein Durchschnitt und deine Anzahl Spiele angezeigt werden. Wir speichern davon nur einen Hashwert. Es läuft 30 Tage nach deinem letzten Spiel ab.',
				'Ein Sprach-Cookie (pq.lang): die gewählte Sprache, während eines Jahres.',
				'Deine Spiele: der gewählte Rat und die Sprache, deine Antworten, deine Antwortzeiten und deine Punkte. Sie dienen dem Spiel, dem Vergleich mit deinen früheren Spielen und mit den Spielen des Monats.',
				'Das Teilen deines Ergebnisses: Am Ende jedes Spiels bereiten wir ein Bild deines Ergebnisses vor (Punkte, Rat, Anzahl richtiger Antworten), damit der Teilen-Knopf sofort reagiert. Es verrät nicht, wer gespielt hat. Wenn du es teilst oder speicherst, hängt diese Kopie nicht mehr von uns ab und verschwindet nicht, wenn das Spiel gelöscht wird.',
				'Ein Besucherzähler: die Anzahl Seitenaufrufe pro Tag, nach Sprache, Gerät (Handy oder Computer) und Herkunftsseite (zum Beispiel google.com; nur der Name der Website, nie eine IP-Adresse oder der Rest des Links). Um die Besucher eines Tages ohne Cookie zu zählen, bilden wir einen Fingerabdruck aus deiner IP-Adresse, deinem Browser und einem Zufallswert, der jeden Tag wechselt und nie gespeichert wird. Diesen Fingerabdruck bewahren wir auf, aber deine Adresse lässt sich daraus nicht zurückgewinnen. Wenn dein Browser verlangt, nicht verfolgt zu werden (Do Not Track oder Global Privacy Control), werden deine Besuche nicht gezählt. Ein gestartetes Spiel zählt trotzdem zur Anzahl Spiele des Tages, eine reine Summe ohne Angaben zu dir.'
			]
		},
		{
			title: 'Was wir nicht speichern',
			paragraphs: [
				'Keinen Namen, keine E-Mail-Adresse, kein Konto, keine IP-Adresse. Keine Werbung, kein Tracking-Werkzeug von Dritten, keine Schriften oder Dienste, die von einer anderen Website geladen werden.'
			]
		},
		{
			title: 'Deine IP-Adresse',
			paragraphs: [
				'Deine IP-Adresse dient nur im Arbeitsspeicher dazu, das Spiel vor Missbrauch zu schützen (zu viele Anfragen in kurzer Zeit) und den oben beschriebenen Tages-Fingerabdruck zu bilden. Sie wird nie in unsere Datenbank geschrieben. Das Hosting kann sie eine Zeit lang in seinen technischen Protokollen aufbewahren, für Sicherheit und Fehlersuche.'
			]
		},
		{
			title: 'Wo die Website läuft',
			paragraphs: [
				'Die Website läuft auf der Infrastruktur von Liip. Die Porträts stammen von parlament.ch (© ParlCH); unser Server lädt sie von rokka, dem Bilderdienst von Liip, und dein Browser kontaktiert nur parlaqui.ch. Die Liste der Ratsmitglieder stammt aus den offenen Daten des Parlaments (ws.parl.ch).'
			]
		},
		{
			title: 'Wie lange',
			paragraphs: [
				'Die Verbindung zwischen deinem Browser und deinen Spielen wird etwa 90 Tage nach dem Start deines letzten Spiels gelöscht. Deine Spiele bleiben danach ohne Verbindung zu deinem Browser für die Statistik bestehen. Ein Spiel, das du nicht beendest, wird etwa 24 Stunden nach dem Start mit deinen Antworten gelöscht. Der Besucherzähler wird 400 Tage aufbewahrt. Eine Sicherungskopie der Datenbank, die jeden Tag neu erstellt wird, kann gelöschte Daten bis zur nächsten Kopie enthalten, in der Regel einen Tag länger.'
			]
		},
		{
			title: 'Deine Rechte',
			paragraphs: [
				'Du kannst die Cookies deines Browsers jederzeit löschen: Deine Spiele lassen sich dann nicht mehr mit diesem Browser verbinden, und die Verbindung wird etwa 90 Tage nach dem Start deines letzten Spiels aus unserer Datenbank gelöscht. Für eine Anfrage auf Auskunft, Berichtigung oder Löschung schreib an contact@liip.ch. Da wir deinen Namen nicht kennen, gib wenn möglich Tag und Uhrzeit deiner Spiele an.'
			]
		}
	],
	updated: 'Fassung vom 4. November 2026'
};

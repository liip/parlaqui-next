import type { Privacy } from './index';

export const it: Privacy = {
	title: 'Protezione dei dati',
	intro:
		'Parlaqui si gioca senza account, senza nome e senza indirizzo e-mail. Questa pagina spiega che cosa registra il sito, perché e per quanto tempo.',
	sections: [
		{
			title: 'Chi è responsabile',
			paragraphs: [
				'Parlaqui è gestito da Liip AG, Rue de la Banque 1, 1701 Friburgo, Svizzera. Per qualsiasi domanda sui tuoi dati: contact@liip.ch.'
			]
		},
		{
			title: 'Che cosa registriamo',
			paragraphs: [
				"Un cookie di gioco (pq.visitor): un identificativo casuale che collega le tue partite a questo browser, per continuare una partita in corso e mostrare il tuo record, la tua media e il numero di partite. Ne conserviamo solo un'impronta calcolata con una funzione di hash. Scade 30 giorni dopo la tua ultima partita.",
				'Un cookie di lingua (pq.lang): la lingua scelta, per un anno.',
				'Le tue partite: il Consiglio e la lingua scelti, le tue risposte, i tuoi tempi di risposta e il tuo punteggio. Servono al gioco, al confronto con le tue partite precedenti e con le partite del mese.',
				"La condivisione del tuo punteggio: alla fine di ogni partita prepariamo un'immagine del tuo punteggio (punti, Consiglio, numero di risposte giuste), perché il pulsante Condividi risponda subito. Non indica chi ha giocato. Se la condividi o la salvi, quella copia non dipende più da noi e non scompare quando la partita viene cancellata.",
				"Un contatore delle visite: il numero di pagine viste al giorno, per lingua, tipo di dispositivo (telefono o computer) e sito di provenienza (per esempio google.com; solo il nome del sito, mai un indirizzo IP né il resto del link). Per contare i visitatori di una giornata senza cookie calcoliamo un'impronta dal tuo indirizzo IP, dal tuo browser e da un valore casuale che cambia ogni giorno e non viene mai registrato. Conserviamo questa impronta, ma il tuo indirizzo non può esserne ricavato. Se il tuo browser chiede di non essere tracciato (Do Not Track o Global Privacy Control), le tue visite non vengono contate. Una partita iniziata conta comunque nel numero di partite del giorno, un semplice totale senza nulla che ti riguardi."
			]
		},
		{
			title: 'Che cosa non registriamo',
			paragraphs: [
				'Né nome, né indirizzo e-mail, né account, né indirizzo IP. Nessuna pubblicità, nessuno strumento di tracciamento di terzi, nessun carattere o servizio caricato da un altro sito.'
			]
		},
		{
			title: 'Il tuo indirizzo IP',
			paragraphs: [
				"Il tuo indirizzo IP serve solo, in memoria, a proteggere il gioco dagli abusi (troppe richieste in poco tempo) e a calcolare l'impronta del giorno descritta sopra. Non viene mai scritto nella nostra banca dati. L'hosting può conservarlo per un certo tempo nei suoi registri tecnici, per la sicurezza e la risoluzione dei problemi."
			]
		},
		{
			title: 'Dove funziona il sito',
			paragraphs: [
				"Il sito funziona sull'infrastruttura di Liip. I ritratti provengono da parlament.ch (© ParlCH); il nostro server li carica da rokka, il servizio di immagini di Liip, e il tuo browser contatta solo parlaqui.ch. L'elenco dei parlamentari proviene dai dati aperti del Parlamento (ws.parl.ch)."
			]
		},
		{
			title: 'Per quanto tempo',
			paragraphs: [
				"Il collegamento tra il tuo browser e le tue partite viene cancellato circa 90 giorni dopo l'inizio della tua ultima partita. Le tue partite restano poi, senza collegamento con il tuo browser, per le statistiche. Una partita che non finisci viene cancellata con le tue risposte circa 24 ore dopo l'inizio. Il contatore delle visite viene conservato 400 giorni. Una copia di sicurezza della banca dati, rifatta ogni giorno, può conservare un dato cancellato fino alla copia successiva, di norma un giorno in più."
			]
		},
		{
			title: 'I tuoi diritti',
			paragraphs: [
				"Puoi cancellare i cookie del tuo browser in qualsiasi momento: le tue partite non possono più essere collegate a questo browser, e il collegamento viene cancellato dalla nostra banca dati circa 90 giorni dopo l'inizio della tua ultima partita. Per una richiesta di accesso, rettifica o cancellazione scrivi a contact@liip.ch. Poiché non conosciamo il tuo nome, indica se possibile il giorno e l'ora delle tue partite."
			]
		}
	],
	updated: 'Versione del 4 novembre 2026'
};

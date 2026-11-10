import type { Privacy } from './index';

export const fr: Privacy = {
	title: 'Confidentialité',
	intro:
		'Parlaqui se joue sans compte, sans nom et sans adresse e-mail. Cette page explique ce que le site enregistre, pourquoi et pendant combien de temps.',
	sections: [
		{
			title: 'Qui est responsable',
			paragraphs: [
				'Parlaqui est exploité par Liip AG, Rue de la Banque 1, 1701 Fribourg, Suisse. Pour toute question sur tes données : contact@liip.ch.'
			]
		},
		{
			title: 'Ce que nous enregistrons',
			paragraphs: [
				"Un cookie de partie (pq.visitor) : un identifiant aléatoire qui relie tes parties à ce navigateur, pour continuer une partie en cours et afficher ton record, ta moyenne et ton nombre de parties. Nous n'en gardons qu'une empreinte, calculée par hachage. Il expire 30 jours après ta dernière partie.",
				'Un cookie de langue (pq.lang) : la langue choisie, pendant un an.',
				'Tes parties : le conseil et la langue choisis, tes réponses, tes temps de réponse et ton score. Ils servent au jeu, à la comparaison avec tes parties précédentes et à celle avec les parties du mois.',
				"Le partage de ton score : à la fin de chaque partie, nous préparons une image de ton score (points, conseil, nombre de bonnes réponses), pour que le bouton Partager réponde tout de suite. Elle n'indique pas qui a joué. Si tu la partages ou l'enregistres, cette copie ne dépend plus de nous et ne disparaît pas quand la partie est effacée.",
				"Un compteur d'audience : le nombre de pages vues par jour, par langue, par type d'appareil (téléphone ou ordinateur) et par site d'origine (par exemple google.com ; seulement le nom du site, jamais une adresse IP ni le reste du lien). Pour compter les visiteurs d'une journée sans cookie, nous calculons une empreinte à partir de ton adresse IP, de ton navigateur et d'une valeur aléatoire qui change chaque jour et n'est jamais enregistrée. Nous gardons cette empreinte, mais ton adresse ne peut pas en être retrouvée. Si ton navigateur demande à ne pas être suivi (Do Not Track ou Global Privacy Control), tes visites ne sont pas comptées. Une partie lancée compte quand même dans le nombre de parties du jour, un simple total sans rien qui te concerne."
			]
		},
		{
			title: "Ce que nous n'enregistrons pas",
			paragraphs: [
				"Ni nom, ni adresse e-mail, ni compte, ni adresse IP. Pas de publicité, pas d'outil de suivi d'un tiers, pas de police ni de service chargé depuis un autre site."
			]
		},
		{
			title: 'Ton adresse IP',
			paragraphs: [
				"Ton adresse IP sert seulement, en mémoire, à protéger le jeu contre les abus (trop de requêtes en peu de temps) et à calculer l'empreinte du jour décrite plus haut. Elle n'est jamais écrite dans notre base de données. L'hébergement peut la garder quelque temps dans ses journaux techniques, pour la sécurité et le dépannage."
			]
		},
		{
			title: 'Où le site fonctionne',
			paragraphs: [
				"Le site fonctionne sur l'infrastructure de Liip. Les portraits viennent de parlament.ch (© ParlCH) ; notre serveur les charge depuis rokka, le service d'images de Liip, et ton navigateur ne contacte que parlaqui.ch. La liste des parlementaires vient des données ouvertes du Parlement (ws.parl.ch)."
			]
		},
		{
			title: 'Pendant combien de temps',
			paragraphs: [
				"Le lien entre ton navigateur et tes parties est effacé environ 90 jours après le début de ta dernière partie. Tes parties restent ensuite, sans lien avec ton navigateur, pour les statistiques. Une partie que tu ne termines pas est effacée avec tes réponses environ 24 heures après son début. Le compteur d'audience est gardé 400 jours. Une copie de sauvegarde de la base, refaite chaque jour, peut garder une donnée effacée jusqu'à la copie suivante, en principe un jour de plus."
			]
		},
		{
			title: 'Tes droits',
			paragraphs: [
				"Tu peux effacer les cookies de ton navigateur à tout moment : tes parties ne peuvent alors plus être reliées à ce navigateur, et ce lien est effacé de notre base environ 90 jours après le début de ta dernière partie. Pour une demande d'accès, de rectification ou d'effacement, écris à contact@liip.ch. Comme nous ne connaissons pas ton nom, indique si possible le jour et l'heure de tes parties."
			]
		}
	],
	updated: 'Version du 4 novembre 2026'
};

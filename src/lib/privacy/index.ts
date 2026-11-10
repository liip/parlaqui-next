import type { Language } from '$lib/i18n';
import { de } from './de';
import { fr } from './fr';
import { it } from './it';
import { rm } from './rm';

export type Privacy = {
	title: string;
	intro: string;
	sections: { title: string; paragraphs: string[] }[];
	updated: string;
};

export const privacy: Record<Language, Privacy> = { de, fr, it, rm };

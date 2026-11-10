let keyboard = false;

export const keyboardPlayer = () => keyboard;

export const trackInputModality = () => {
	const onKey = () => (keyboard = true);
	const onPointer = () => (keyboard = false);
	window.addEventListener('keydown', onKey, true);
	window.addEventListener('pointerdown', onPointer, true);
	return () => {
		window.removeEventListener('keydown', onKey, true);
		window.removeEventListener('pointerdown', onPointer, true);
	};
};

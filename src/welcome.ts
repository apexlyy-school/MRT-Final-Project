const title = 'Welcome to RiftVR!';
const paragraphs = [
    'This is a virtual tabletop for the card game Riftbound, made as part of my university project. It is not in any way affiliated with Riot Games, and content has been taken from RiftAtlas for inspiration. The API RiftCodex is used to fetch card data.',
    'To get started, use the "Select Deck" button in the bottom right to choose one of our sample decks to start playing, or import your own.'
];

/** Welcome overlay shown when the table loads. */
export const mountWelcome = () => {
    const overlay = document.createElement('div');
    overlay.className = 'welcome';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Welcome');

    const panel = document.createElement('div');
    panel.className = 'welcome-panel';

    const body = document.createElement('div');
    body.className = 'welcome-body';

    const heading = document.createElement('h1');
    heading.className = 'welcome-title';
    heading.textContent = title;
    body.append(heading);

    for (const line of paragraphs) {
        const copy = document.createElement('p');
        copy.className = 'welcome-copy';
        copy.textContent = line;
        body.append(copy);
    }

    const footer = document.createElement('div');
    footer.className = 'welcome-footer';

    const closeButton = document.createElement('button');
    closeButton.className = 'welcome-close';
    closeButton.type = 'button';
    closeButton.textContent = 'Close';

    footer.append(closeButton);
    panel.append(body, footer);
    overlay.append(panel);
    document.body.append(overlay);

    const close = () => {
        overlay.remove();
        window.removeEventListener('keydown', onKeyDown);
    };

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            close();
        }
    };

    closeButton.addEventListener('click', close);

    // Keep camera and card input from eating clicks while the welcome is open.
    const block = (event: Event) => {
        event.stopPropagation();
    };
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'wheel'] as const) {
        overlay.addEventListener(type, block);
    }
    window.addEventListener('keydown', onKeyDown);
};

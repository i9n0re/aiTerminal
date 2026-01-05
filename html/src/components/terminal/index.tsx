import { bind } from 'decko';
import { Component, h } from 'preact';
import { Xterm, XtermOptions } from './xterm';
import type { IDisposable } from '@xterm/xterm';

import '@xterm/xterm/css/xterm.css';
import { Modal } from '../modal';

interface Props extends XtermOptions {
    id: string;
}

interface State {
    modal: boolean;
    title: string;
    toolbarVisible: boolean;
}

export class Terminal extends Component<Props, State> {
    private container: HTMLElement;
    private xterm: Xterm;
    private titleDisposable: IDisposable | undefined;

    constructor(props: Props) {
        super();
        this.xterm = new Xterm(props, this.showModal);
        this.state = { modal: false, title: 'Terminal', toolbarVisible: true };
    }

    async componentDidMount() {
        await this.xterm.refreshToken();
        this.xterm.open(this.container);
        this.xterm.connect();
        this.initTouchScroll();
        this.initVisualViewport();

        // Listen for title changes
        this.titleDisposable = this.xterm.onTitleChange(newTitle => {
            if (newTitle) {
                this.setState({ title: newTitle });
            }
        });
    }

    initVisualViewport() {
        if (!window.visualViewport) return;

        let fitTimeout: ReturnType<typeof setTimeout>;

        const updateLayout = () => {
            if (!this.container) return;

            if (window.visualViewport) {
                // 完全贴合当前可见视口 (实时更新，保证背景黑框不乱跑)

                this.container.style.height = `${Math.max(1, window.visualViewport.height)}px`;

                this.container.style.width = `${Math.max(1, window.visualViewport.width)}px`;

                this.container.style.top = `${window.visualViewport.offsetTop}px`;

                this.container.style.left = `${window.visualViewport.offsetLeft}px`;
            }

            // Trigger fit addon to resize terminal rows

            // Debounce fit to avoid flickering during keyboard animation

            if (window.term && window.term.fit) {
                clearTimeout(fitTimeout);

                fitTimeout = setTimeout(() => {
                    window.term.fit();

                    // Scroll to bottom after fit to ensure cursor is visible

                    window.term.scrollToBottom();
                }, 200);
            }
        };

        window.visualViewport.addEventListener('resize', updateLayout);

        window.visualViewport.addEventListener('scroll', updateLayout);

        // Initial call

        updateLayout();
    }

    initTouchScroll() {
        let touchStartY = 0;

        const terminalEl = this.container.querySelector('.xterm-screen');

        if (!terminalEl) return;

        // Passive false to allow preventing default (scrolling body)

        terminalEl.addEventListener(
            'touchstart',

            ((e: TouchEvent) => {
                if (e.touches.length === 1) {
                    touchStartY = e.touches[0].clientY;
                }
            }) as unknown as EventListener,

            { passive: false }
        );

        terminalEl.addEventListener(
            'touchmove',

            ((e: TouchEvent) => {
                if (e.touches.length === 1) {
                    const touchEndY = e.touches[0].clientY;
                    const deltaY = touchStartY - touchEndY;

                    // Sensitivity (Lowered threshold for smoother response)
                    if (Math.abs(deltaY) > 8) {
                        const canvas = this.container.querySelector('.xterm-link-layer + canvas');
                        if (canvas) {
                            // Acceleration for fast swipes
                            const multiplier = Math.abs(deltaY) > 30 ? 3 : 1;

                            const wheelEvent = new WheelEvent('wheel', {
                                deltaY: deltaY * multiplier,
                                deltaMode: 0, // Pixel
                                bubbles: true,
                                cancelable: true,
                                clientX: e.touches[0].clientX,
                                clientY: e.touches[0].clientY,
                            });
                            canvas.dispatchEvent(wheelEvent);
                        }
                        touchStartY = touchEndY;
                    }
                    // Prevent browser native scroll
                    if (e.cancelable) e.preventDefault();
                }
            }) as unknown as EventListener,

            { passive: false }
        );
    }

    componentWillUnmount() {
        this.xterm.dispose();
        if (this.titleDisposable) {
            this.titleDisposable.dispose();
        }
    }

    @bind
    sendKey(key: string) {
        this.xterm.sendData(key);
    }

    @bind
    sendTmuxKey(action: string) {
        // Ctrl+B is \x02

        const prefix = '\x02';

        this.xterm.sendData(prefix + action);
    }

    @bind
    toggleToolbar() {
        this.setState({ toolbarVisible: !this.state.toolbarVisible });
    }

    render({ id }: Props, { modal, title, toolbarVisible }: State) {
        // Watermark Style

        const watermarkStyle = {
            position: 'absolute',

            top: '15%', // Moved to top

            left: '50%',

            transform: 'translate(-50%, -50%)',

            fontSize: '15vw', // Responsive font size

            fontWeight: '900',

            color: 'rgba(255, 0, 0, 0.15)', // Lighter red

            pointerEvents: 'none',

            zIndex: 9999, // Above terminal text but click-through

            whiteSpace: 'nowrap',

            userSelect: 'none',

            fontFamily: 'sans-serif',

            textAlign: 'center',

            width: '100%',

            overflow: 'hidden',
        };

        // Side Toolbar

        const toolbarStyle = {
            position: 'fixed',

            top: '50%', // Centered

            right: '0',

            transform: 'translateY(-50%)',

            zIndex: 10000,

            display: 'flex',

            flexDirection: 'column',

            gap: '8px',

            padding: '12px 8px',

            background: 'rgba(30, 30, 30, 0.7)',

            borderTopLeftRadius: '12px',

            borderBottomLeftRadius: '12px',

            backdropFilter: 'blur(12px)',

            webkitBackdropFilter: 'blur(12px)',

            boxShadow: '-4px 0 16px rgba(0,0,0,0.4)',
        };

        const buttonStyle = {
            background: 'rgba(255, 255, 255, 0.15)',

            border: '1px solid rgba(255, 255, 255, 0.3)',

            color: '#fff',

            padding: '8px 12px', // Smaller

            cursor: 'pointer',

            borderRadius: '8px',

            fontSize: '13px',

            fontWeight: 'bold',

            userSelect: 'none',

            outline: 'none',

            boxShadow: '0 3px 6px rgba(0,0,0,0.4)',

            textAlign: 'center',

            minWidth: '50px',
        };

        return (
            <div id={id} ref={c => (this.container = c as HTMLElement)}>
                {/* Watermark Title */}

                <div style={watermarkStyle}>{title}</div>

                <div style={toolbarStyle} className="quick-keys">
                    <button
                        style={{ ...buttonStyle, background: 'rgba(0, 150, 255, 0.3)' }}
                        onClick={this.toggleToolbar}
                    >
                        {toolbarVisible ? '»' : '«'}
                    </button>

                    {toolbarVisible && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button style={buttonStyle} onClick={() => this.sendKey('\x1b')}>
                                Esc
                            </button>

                            <button style={buttonStyle} onClick={() => this.sendTmuxKey('c')}>
                                New
                            </button>

                            <button style={buttonStyle} onClick={() => this.sendTmuxKey(',')}>
                                Rename
                            </button>

                            <button style={buttonStyle} onClick={() => this.sendTmuxKey('w')}>
                                List
                            </button>

                            <button style={buttonStyle} onClick={() => this.sendTmuxKey('p')}>
                                Prev
                            </button>

                            <button style={buttonStyle} onClick={() => this.sendTmuxKey('n')}>
                                Next
                            </button>

                            <button style={buttonStyle} onClick={() => this.sendKey('\t')}>
                                Tab
                            </button>

                            <button style={buttonStyle} onClick={() => this.sendKey('\x06')}>
                                Ctrl+F
                            </button>

                            <button style={buttonStyle} onClick={() => this.sendKey('\x03')}>
                                Ctrl+C
                            </button>
                        </div>
                    )}
                </div>

                <Modal show={modal}>
                    <label class="file-label">
                        <input onChange={this.sendFile} class="file-input" type="file" multiple />
                        <span class="file-cta">Choose files…</span>
                    </label>
                </Modal>
            </div>
        );
    }

    @bind
    showModal() {
        this.setState({ modal: true });
    }

    @bind
    sendFile(event: Event) {
        this.setState({ modal: false });
        const files = (event.target as HTMLInputElement).files;
        if (files) this.xterm.sendFile(files);
    }
}

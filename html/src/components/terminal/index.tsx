import { bind } from 'decko';
import { Component, h } from 'preact';
import { Xterm, XtermOptions } from './xterm';
import type { IDisposable } from '@xterm/xterm';

import '@xterm/xterm/css/xterm.css';
import { Modal } from '../modal';

interface WindowInfo {
    index: number;
    name: string;
    active: boolean;
}

interface Props extends XtermOptions {
    id: string;
}

interface State {
    modal: boolean;
    title: string;
    toolbarVisible: boolean;
    sidebarVisible: boolean;
    windows: WindowInfo[];
    ready: boolean;
    webMouseMode: boolean;
    viewportHeight: number;
    viewportWidth: number;
    viewportOffsetTop: number;
    viewportOffsetLeft: number;
    keyboardInset: number;
}

interface VirtualKeyboardApi extends EventTarget {
    overlaysContent: boolean;
    boundingRect: DOMRectReadOnly;
}

interface NavigatorWithVirtualKeyboard extends Navigator {
    virtualKeyboard?: VirtualKeyboardApi;
}

function getViewportMetrics() {
    const viewport = window.visualViewport;
    const height = viewport ? Math.min(viewport.height, window.innerHeight) : window.innerHeight;
    const width = viewport ? Math.min(viewport.width, window.innerWidth) : window.innerWidth;
    return {
        viewportHeight: Math.round(height),
        viewportWidth: Math.round(width),
        viewportOffsetTop: Math.round(viewport ? viewport.offsetTop : 0),
        viewportOffsetLeft: Math.round(viewport ? viewport.offsetLeft : 0),
    };
}

function getVirtualKeyboardInset() {
    const keyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;
    const rect = keyboard?.boundingRect;
    if (!rect) return 0;
    return Math.max(0, Math.round(Math.min(rect.height, window.innerHeight - rect.y)));
}

function isMobileViewport() {
    return window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 900;
}

function isEditableElement(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.isContentEditable) return true;

    const tagName = el.tagName;
    if (tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
    if (tagName !== 'INPUT') return false;

    const input = el as HTMLInputElement;
    return !input.readOnly && !input.disabled && input.type !== 'button' && input.type !== 'submit';
}

const TERMINAL_BACKGROUND = '#000';

export class Terminal extends Component<Props, State> {
    private container: HTMLElement;
    private terminalEl: HTMLElement;
    private xterm: Xterm;
    private titleDisposable: IDisposable | undefined;
    private viewportResizeObserver: ResizeObserver | undefined;
    private viewportFitTimeout: ReturnType<typeof setTimeout> | undefined;
    private viewportAnimationFrame: number | undefined;
    private keyboardFallbackTimeout: ReturnType<typeof setTimeout> | undefined;
    private keyboardFitTimeouts: ReturnType<typeof setTimeout>[] = [];
    private maxObservedViewportHeight = getViewportMetrics().viewportHeight;
    private terminalFocused = false;
    private lastTerminalPointerTime = 0;
    private keyboardOpenRequestTime = 0;
    private hadKeyboardViewportSignal = false;
    private terminalTouchMoved = false;

    constructor(props: Props) {
        super();
        this.xterm = new Xterm(props, this.showModal);
        this.state = {
            modal: false,
            title: 'Terminal',
            toolbarVisible: true,
            sidebarVisible: false,
            windows: [],
            ready: false,
            webMouseMode: false,
            keyboardInset: 0,
            ...getViewportMetrics(),
        };
    }

    async componentDidMount() {
        if ('scrollRestoration' in window.history) {
            window.history.scrollRestoration = 'manual';
        }
        window.scrollTo(0, 0);
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';

        await this.xterm.refreshToken();
        this.xterm.open(this.terminalEl);
        if (window.term && window.term.fit) window.term.fit();
        this.xterm.connect();
        this.initTouchScroll();
        this.initVisualViewport();
        this.initKeyboardAvoidance();
        window.addEventListener('keydown', this.onGlobalKeyDown, true);

        this.titleDisposable = this.xterm.onTitleChange(newTitle => {
            if (newTitle && newTitle !== this.state.title) this.setState({ title: newTitle });
        });

        this.xterm.onServerData(data => {
            if (data.includes('__TMUX_DATA__:')) {
                this.parseWindowsData(data);
                return true;
            }
            return false;
        });

        setTimeout(() => this.setState({ ready: true }), 50);
    }

    @bind
    parseWindowsData(data: string) {
        const foundWindows: WindowInfo[] = [];
        data.split(/\r?\n/).forEach(line => {
            const match = line.match(/^__TMUX_DATA__:(\d+):(.*):([01])$/);
            if (!match) return;
            foundWindows.push({
                index: parseInt(match[1], 10),
                name: match[2],
                active: match[3] === '1',
            });
        });
        this.setState({ windows: foundWindows.sort((a, b) => a.index - b.index) });
    }

    @bind refreshWindows() { this.xterm.sendCommand('4'); }
    @bind selectWindow(index: number) { this.xterm.sendCommand('5', index.toString()); }

    @bind
    toggleMouseMode() {
        const newMode = !this.state.webMouseMode;
        this.setState({ webMouseMode: newMode });
        this.xterm.setWebMouseMode(newMode);
    }

    initVisualViewport() {
        const viewport = window.visualViewport;
        if (viewport) {
            viewport.addEventListener('resize', this.updateViewportLayout);
            viewport.addEventListener('scroll', this.updateViewportLayout);
        }
        window.addEventListener('resize', this.updateViewportLayout);

        if ('ResizeObserver' in window) {
            this.viewportResizeObserver = new ResizeObserver(this.updateViewportLayout);
            this.viewportResizeObserver.observe(this.container);
        }
        this.updateViewportLayout();
    }

    @bind
    updateViewportLayout() {
        if (this.viewportAnimationFrame) {
            cancelAnimationFrame(this.viewportAnimationFrame);
        }

        this.viewportAnimationFrame = requestAnimationFrame(() => {
            this.viewportAnimationFrame = undefined;
            if (!this.container || !this.terminalEl) return;

            const nextMetrics = getViewportMetrics();
            if (!this.terminalFocused || nextMetrics.viewportHeight > this.maxObservedViewportHeight) {
                this.maxObservedViewportHeight = nextMetrics.viewportHeight;
            }
            this.updateKeyboardCloseState(nextMetrics.viewportHeight);

            const hasChanged =
                nextMetrics.viewportHeight !== this.state.viewportHeight ||
                nextMetrics.viewportWidth !== this.state.viewportWidth ||
                nextMetrics.viewportOffsetTop !== this.state.viewportOffsetTop ||
                nextMetrics.viewportOffsetLeft !== this.state.viewportOffsetLeft;

            if (hasChanged) {
                this.setState(nextMetrics);
            }

            this.fitTerminal(120);

            window.scrollTo(0, 0);
        });
    }

    initKeyboardAvoidance() {
        const keyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;
        if (keyboard) {
            try {
                keyboard.overlaysContent = false;
            } catch {
                // Some browsers expose the API without allowing runtime policy changes.
            }
            keyboard.addEventListener('geometrychange', this.updateVirtualKeyboardInset);
            this.updateVirtualKeyboardInset();
        }

        this.terminalEl.addEventListener('focusin', this.onTerminalFocusIn);
        this.terminalEl.addEventListener('focusout', this.onTerminalFocusOut);
        this.terminalEl.addEventListener('pointerup', this.onTerminalPointer);
        this.terminalEl.addEventListener('touchend', this.onTerminalPointer);
    }

    @bind
    onGlobalKeyDown(event: KeyboardEvent) {
        if (event.key !== 'Backspace' || event.defaultPrevented || isEditableElement(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        if (window.term && window.term.focus) window.term.focus();
    }

    @bind
    updateVirtualKeyboardInset() {
        const keyboardInset = getVirtualKeyboardInset();
        if (keyboardInset > 0) {
            this.hadKeyboardViewportSignal = true;
        }
        this.setKeyboardInset(keyboardInset);
        this.scheduleKeyboardFits();
    }

    @bind
    onTerminalPointer(event: Event) {
        if ('pointerType' in event && (event as PointerEvent).pointerType === 'touch') {
            return;
        }

        if (event.type === 'touchend' && this.terminalTouchMoved) {
            this.terminalTouchMoved = false;
            this.keyboardOpenRequestTime = 0;
            this.clearKeyboardFallback();
            return;
        }

        this.terminalTouchMoved = false;
        this.lastTerminalPointerTime = Date.now();
        this.keyboardOpenRequestTime = this.lastTerminalPointerTime;
        this.terminalFocused = true;
        if (window.term && window.term.focus) window.term.focus();
        this.scheduleKeyboardFits();
        this.scheduleKeyboardFallback(260);
    }

    @bind
    onTerminalFocusIn() {
        this.terminalFocused = true;
        this.scheduleKeyboardFits();
        if (Date.now() - this.lastTerminalPointerTime < 1000) {
            this.keyboardOpenRequestTime = Date.now();
            this.scheduleKeyboardFallback(180);
        }
    }

    @bind
    onTerminalFocusOut() {
        this.terminalFocused = false;
        this.keyboardOpenRequestTime = 0;
        this.hadKeyboardViewportSignal = false;
        this.clearKeyboardFallback();
        this.setKeyboardInset(0);
        this.scheduleKeyboardFits();
    }

    setKeyboardInset(keyboardInset: number) {
        if (keyboardInset === this.state.keyboardInset) return;
        this.setState({ keyboardInset }, () => this.fitTerminal(80));
    }

    getMobileKeyboardInsetEstimate() {
        const keyboardInset = getVirtualKeyboardInset();
        if (keyboardInset > 0) return keyboardInset;

        const metrics = getViewportMetrics();
        const viewportShrink = Math.max(0, this.maxObservedViewportHeight - metrics.viewportHeight);
        if (viewportShrink > 80) return viewportShrink;

        return Math.round(this.maxObservedViewportHeight * 0.42);
    }

    updateKeyboardCloseState(viewportHeight: number) {
        const viewportShrink = Math.max(0, this.maxObservedViewportHeight - viewportHeight);
        const keyboardInset = getVirtualKeyboardInset();
        if (viewportShrink > 80 || keyboardInset > 0) {
            this.hadKeyboardViewportSignal = true;
            return;
        }

        const recentlyRequestedKeyboard = Date.now() - this.keyboardOpenRequestTime < 900;
        if (this.state.keyboardInset > 0 && this.hadKeyboardViewportSignal && !recentlyRequestedKeyboard) {
            this.hadKeyboardViewportSignal = false;
            this.setKeyboardInset(0);
        }
    }

    scheduleKeyboardFits() {
        this.keyboardFitTimeouts.forEach(timeout => clearTimeout(timeout));
        this.keyboardFitTimeouts = [40, 140, 320, 700].map(delay =>
            setTimeout(() => {
                this.updateViewportLayout();
                this.fitTerminal(0);
            }, delay)
        );
    }

    scheduleKeyboardFallback(delay = 220) {
        this.clearKeyboardFallback();
        if (!isMobileViewport()) return;
        const requestTime = this.keyboardOpenRequestTime;

        this.keyboardFallbackTimeout = setTimeout(() => {
            if (!this.terminalFocused) return;
            if (!requestTime || requestTime !== this.keyboardOpenRequestTime) return;
            if (Date.now() - requestTime > 900) return;
            this.setKeyboardInset(this.getMobileKeyboardInsetEstimate());
            this.scheduleKeyboardFits();
        }, delay);
    }

    clearKeyboardFallback() {
        if (this.keyboardFallbackTimeout) clearTimeout(this.keyboardFallbackTimeout);
        this.keyboardFallbackTimeout = undefined;
    }

    fitTerminal(delay: number) {
        if (!window.term || !window.term.fit) return;
        if (this.viewportFitTimeout) clearTimeout(this.viewportFitTimeout);
        this.viewportFitTimeout = setTimeout(() => window.term.fit(), delay);
    }

    initTouchScroll() {
        let touchStartY = 0;
        let touchLastY = 0;
        const el = this.terminalEl;
        if (!el) return;
        el.addEventListener('touchstart', ((e: TouchEvent) => {
            if (e.touches.length === 1) {
                touchStartY = e.touches[0].clientY;
                touchLastY = touchStartY;
                this.terminalTouchMoved = false;
            }
        }) as unknown as EventListener, { passive: false });
        el.addEventListener('touchmove', ((e: TouchEvent) => {
            if (e.touches.length === 1) {
                const currentY = e.touches[0].clientY;
                if (Math.abs(touchStartY - currentY) > 8) {
                    this.terminalTouchMoved = true;
                    this.keyboardOpenRequestTime = 0;
                    this.clearKeyboardFallback();
                }
                const deltaY = touchLastY - currentY;
                if (Math.abs(deltaY) > 8) {
                    const canvas = el.querySelector('.xterm-link-layer + canvas');
                    if (canvas) {
                        const wheelEvent = new WheelEvent('wheel', { deltaY: deltaY * (Math.abs(deltaY) > 30 ? 3 : 1), deltaMode: 0, bubbles: true, cancelable: true });
                        canvas.dispatchEvent(wheelEvent);
                    }
                    touchLastY = currentY;
                }
                if (e.cancelable) e.preventDefault();
            }
        }) as unknown as EventListener, { passive: false });
    }

    componentWillUnmount() {
        const viewport = window.visualViewport;
        if (viewport) {
            viewport.removeEventListener('resize', this.updateViewportLayout);
            viewport.removeEventListener('scroll', this.updateViewportLayout);
        }
        window.removeEventListener('resize', this.updateViewportLayout);
        const keyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;
        if (keyboard) keyboard.removeEventListener('geometrychange', this.updateVirtualKeyboardInset);
        if (this.terminalEl) {
            this.terminalEl.removeEventListener('focusin', this.onTerminalFocusIn);
            this.terminalEl.removeEventListener('focusout', this.onTerminalFocusOut);
            this.terminalEl.removeEventListener('pointerup', this.onTerminalPointer);
            this.terminalEl.removeEventListener('touchend', this.onTerminalPointer);
        }
        window.removeEventListener('keydown', this.onGlobalKeyDown, true);
        if (this.viewportResizeObserver) this.viewportResizeObserver.disconnect();
        if (this.viewportFitTimeout) clearTimeout(this.viewportFitTimeout);
        if (this.viewportAnimationFrame) cancelAnimationFrame(this.viewportAnimationFrame);
        this.clearKeyboardFallback();
        this.keyboardFitTimeouts.forEach(timeout => clearTimeout(timeout));
        this.xterm.dispose();
        if (this.titleDisposable) this.titleDisposable.dispose();
    }

    @bind sendKey(key: string) { this.xterm.sendData(key); }
    @bind sendTmuxKey(action: string) { this.xterm.sendData('\x02' + action); }
    @bind toggleToolbar() { this.setState({ toolbarVisible: !this.state.toolbarVisible }); }
    @bind toggleSidebar() {
        this.setState({ sidebarVisible: !this.state.sidebarVisible }, () => {
            if (this.state.sidebarVisible) this.refreshWindows();
        });
    }

    render(
        { id }: Props,
        {
            modal,
            title,
            toolbarVisible,
            sidebarVisible,
            windows,
            ready,
            webMouseMode,
            viewportHeight,
            viewportWidth,
            viewportOffsetTop,
            viewportOffsetLeft,
            keyboardInset,
        }: State
    ) {
        const transitionStyle = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        const sidebarWidth = '260px';
        const viewportShrink = Math.max(0, this.maxObservedViewportHeight - viewportHeight);
        const extraKeyboardInset = Math.max(0, keyboardInset - viewportShrink);
        const terminalHeight = Math.max(160, viewportHeight - extraKeyboardInset);

        return (
            <div style={{ 
                position: 'fixed',
                top: `${viewportOffsetTop}px`,
                left: `${viewportOffsetLeft}px`,
                width: `${viewportWidth}px`,
                height: `${terminalHeight}px`,
                overflow: 'hidden',
                background: TERMINAL_BACKGROUND,
                opacity: ready ? 1 : 0, transition: 'opacity 0.2s ease-in'
            }}>
                <div 
                    ref={c => (this.container = c as HTMLElement)}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'hidden' }}
                >
                    <div style={{
                        position: 'absolute', top: '15%', left: '50%', transform: 'translate(-50%, -50%)',
                        fontSize: '15vw', fontWeight: '900', color: 'rgba(255, 0, 0, 0.15)',
                        pointerEvents: 'none', zIndex: 9999, whiteSpace: 'nowrap',
                        userSelect: 'none', textAlign: 'center', width: '100%', overflow: 'hidden',
                    }}>{title}</div>

                    <div id={id} ref={c => (this.terminalEl = c as HTMLElement)} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
                </div>

                <div style={{
                    position: 'absolute', top: 0, right: sidebarVisible ? '0' : `-${sidebarWidth}`,
                    width: sidebarWidth, height: '100%', transition: transitionStyle,
                    background: 'rgba(26, 26, 26, 0.95)', borderLeft: '1px solid #333',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden', color: '#ccc', zIndex: 10001,
                    backdropFilter: 'blur(10px)', webkitBackdropFilter: 'blur(10px)',
                    boxShadow: sidebarVisible ? '-4px 0 16px rgba(0,0,0,0.5)' : 'none',
                }}>
                    <div style={{ padding: '16px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px', fontWeight: 'bold', background: '#252525', whiteSpace: 'nowrap' }}>
                        <span>Windows Manager</span>
                        <button onClick={this.refreshWindows} style={{ background: 'none', border: 'none', color: '#007aff', cursor: 'pointer', fontSize: '18px' }}>↻</button>
                    </div>

                    <div style={{ padding: '12px 16px', background: '#202020', borderBottom: '1px solid #333', whiteSpace: 'nowrap' }}>
                        <button onClick={this.toggleMouseMode} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: 'none', background: webMouseMode ? '#ff9500' : '#333', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', transition: 'all 0.2s' }}>
                            {webMouseMode ? '✓ Web Selection' : 'Terminal (Tmux)'}
                        </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                        {windows.length === 0 && (
                            <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px', color: '#666' }}>
                                <div>No windows detected</div>
                                <div style={{ marginTop: '8px', opacity: 0.7 }}>Click ↻ to sync</div>
                            </div>
                        )}
                        {windows.map(win => (
                            <div key={win.index} onClick={() => this.selectWindow(win.index)} style={{
                                padding: '12px 16px', margin: '4px 8px', borderRadius: '6px',
                                background: win.active ? 'linear-gradient(90deg, #007aff, #005bb5)' : 'transparent',
                                color: win.active ? '#fff' : '#ccc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px',
                                border: win.active ? 'none' : '1px solid #333', boxShadow: win.active ? '0 2px 10px rgba(0,122,255,0.5)' : 'none', transition: 'all 0.2s ease',
                                whiteSpace: 'nowrap'
                            }}>
                                <span style={{ opacity: 0.5, fontSize: '11px', width: '15px' }}>{win.index}</span>
                                <span style={{ fontWeight: win.active ? 'bold' : 'normal', flex: 1 }}>{win.name}</span>
                                {win.active && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fff', boxShadow: '0 0 8px #fff' }} />}
                            </div>
                        ))}
                    </div>
                    <div style={{ padding: '16px', background: '#252525', borderTop: '1px solid #333', whiteSpace: 'nowrap' }}>
                        <button onClick={() => this.sendTmuxKey('c')} style={{ background: '#28a745', border: 'none', color: '#fff', padding: '10px', width: '100%', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', marginBottom: '8px' }}>+ New Window</button>
                        <button onClick={() => this.sendTmuxKey('w')} style={{ background: '#6c757d', border: 'none', color: '#fff', padding: '10px', width: '100%', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Tmux Menu (w)</button>
                    </div>
                </div>

                <div style={{
                    position: 'absolute', top: '50%', right: sidebarVisible ? sidebarWidth : '0',
                    transform: 'translateY(-50%)', zIndex: 10000, display: 'flex',
                    flexDirection: 'column', gap: '8px', padding: '12px 8px',
                    background: 'rgba(30, 30, 30, 0.7)', borderTopLeftRadius: '12px',
                    borderBottomLeftRadius: '12px', backdropFilter: 'blur(12px)',
                    webkitBackdropFilter: 'blur(12px)', boxShadow: '-4px 0 16px rgba(0,0,0,0.4)',
                    transition: transitionStyle,
                }} className="quick-keys">
                    <button style={{ background: 'rgba(0, 150, 255, 0.3)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={this.toggleSidebar}>
                        {sidebarVisible ? '→' : '田'}
                    </button>
                    <button style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={this.toggleToolbar}>
                        {toolbarVisible ? '»' : '«'}
                    </button>

                    {toolbarVisible && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendKey('\x1b')}>Esc</button>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendTmuxKey('c')}>New</button>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendTmuxKey(',')}>Rename</button>
                                                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendTmuxKey('p')}>Prev</button>
                                                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendTmuxKey('n')}>Next</button>
                                                            <div style={{ display: 'flex', gap: '8px' }}>                                <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', minWidth: 'unset', flex: 1 }} onClick={() => this.sendKey('\x1b[D')}>←</button>
                                <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', minWidth: 'unset', flex: 1 }} onClick={() => this.sendKey('\x1b[C')}>→</button>
                            </div>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendKey('\t')}>Tab</button>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendKey('\x06')}>Ctrl+F</button>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendKey('\x03')}>Ctrl+C</button>
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

    @bind showModal() { this.setState({ modal: true }); }
    @bind sendFile(event: Event) {
        this.setState({ modal: false });
        const files = (event.target as HTMLInputElement).files;
        if (files) this.xterm.sendFile(files);
    }
}

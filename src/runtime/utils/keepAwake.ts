const SILENT_AUDIO_BASE64 =
    "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYNbrGcAAAAAAD/+1DEAAAFoANoAAAAACKgA1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7UMQeAAi0A2gAAAAAAACAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+1DEQAAAAAH/AAAAAAAANIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

export class KeepAwake {
    private wakeLock: WakeLockSentinel | null = null;
    private silentAudio: HTMLAudioElement | null = null;
    private logger: (msg: string) => void;
    private isActive = false;

    constructor(logger: (msg: string) => void = () => {}) {
        this.logger = logger;
    }

    async requestWakeLock(): Promise<void> {
        if (!("wakeLock" in navigator)) {
            this.logger("Wake Lock API not supported");
            return;
        }

        try {
            this.wakeLock = await navigator.wakeLock.request("screen");
            this.logger("Wake lock acquired");

            this.wakeLock.addEventListener("release", () => {
                this.logger("Wake lock released");
            });
        } catch (error) {
            this.logger(`Wake lock request failed: ${error}`);
        }
    }

    releaseWakeLock(): void {
        if (this.wakeLock) {
            this.wakeLock.release();
            this.wakeLock = null;
        }
    }

    startSilentAudio(): void {
        if (this.silentAudio) {
            return;
        }

        this.silentAudio = new Audio(SILENT_AUDIO_BASE64);
        this.silentAudio.loop = true;
        this.silentAudio.volume = 0.001;

        this.silentAudio.play().catch((error) => {
            this.logger(`Silent audio playback failed: ${error}`);
        });

        this.logger("Silent audio started");
    }

    stopSilentAudio(): void {
        if (this.silentAudio) {
            this.silentAudio.pause();
            this.silentAudio.src = "";
            this.silentAudio = null;
            this.logger("Silent audio stopped");
        }
    }

    async start(): Promise<void> {
        if (this.isActive) {
            return;
        }

        this.isActive = true;

        this.startSilentAudio();

        await this.requestWakeLock();
    }

    stop(): void {
        this.isActive = false;

        this.releaseWakeLock();
        this.stopSilentAudio();
    }

    async handleVisibilityChange(): Promise<void> {
        if (!this.isActive) {
            return;
        }

        if (document.visibilityState === "visible") {
            this.logger("Page became visible, re-acquiring wake lock");
            await this.requestWakeLock();
        }
    }
}

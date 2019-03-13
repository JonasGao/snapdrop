const $ = query => document.getElementById(query);
const $$ = query => document.body.querySelector(query);
const isURL = text => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());
window.isDownloadSupported = (typeof document.createElement('a').download !== 'undefined');
window.isProductionEnvironment = !window.location.host.startsWith('localhost');
window.iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

class PeersUI {

    constructor() {
        Events.on('peer-joined', e => this._onPeerJoined(e.detail));
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
        Events.on('peers', e => this._onPeers(e.detail));
        Events.on('file-progress', e => this._onFileProgress(e.detail));
    }

    _onPeerJoined(peer) {
        if (document.getElementById(peer.id)) return;
        const peerUI = new PeerUI(peer);
        $$('x-peers').appendChild(peerUI.$el);
    }

    _onPeers(peers) {
        this._clearPeers();
        peers.forEach(peer => this._onPeerJoined(peer));
    }

    _onPeerLeft(peerId) {
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.remove();
    }

    _onFileProgress(progress) {
        const peerId = progress.sender || progress.recipient;
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.ui.setProgress(progress.progress);
    }

    _clearPeers() {
        const $peers = $$('x-peers').innerHTML = '';
    }
}

class PeerUI {

    html() {
        return `   
            <label class="column center">
                <input type="file" multiple>
                <x-icon shadow="1">
                    <svg class="icon"><use xlink:href="#"/></svg>
                </x-icon>
                <div class="progress">
                  <div class="circle"></div>
                  <div class="circle right"></div>
                </div>
                <div class="name font-subheading"></div>
                <div class="status font-body2"></div>
            </label>`
    }

    constructor(peer) {
        this._peer = peer;
        this._initDom();
        this._bindListeners(this.$el);
    }

    _initDom() {
        const el = document.createElement('x-peer');
        el.id = this._peer.id;
        el.innerHTML = this.html();
        el.ui = this;
        el.querySelector('svg use').setAttribute('xlink:href', this._icon());
        el.querySelector('.name').textContent = this._name();
        this.$el = el;
        this.$progress = el.querySelector('.progress');
    }

    _bindListeners(el) {
        el.querySelector('input').addEventListener('change', e => this._onFilesSelected(e));
        el.addEventListener('drop', e => this._onDrop(e));
        el.addEventListener('dragend', e => this._onDragEnd(e));
        el.addEventListener('dragleave', e => this._onDragEnd(e));
        el.addEventListener('dragover', e => this._onDragOver(e));
        el.addEventListener('contextmenu', e => this._onRightClick(e));
        el.addEventListener('touchstart', e => this._onTouchStart(e));
        el.addEventListener('touchend', e => this._onTouchEnd(e));
        // prevent browser's default file drop behavior
        Events.on('dragover', e => e.preventDefault());
        Events.on('drop', e => e.preventDefault());
    }

    _name() {
        if (this._peer.name.model) {
            return this._peer.name.os + ' ' + this._peer.name.model;
        }
        this._peer.name.os = this._peer.name.os.replace('Mac OS', 'Mac');
        return this._peer.name.os + ' ' + this._peer.name.browser;
    }

    _icon() {
        const device = this._peer.name.device || this._peer.name;
        if (device.type === 'mobile') {
            return '#phone-iphone';
        }
        if (device.type === 'tablet') {
            return '#tablet-mac';
        }
        return '#desktop-mac';
    }

    _onFilesSelected(e) {
        const $input = e.target;
        const files = $input.files;
        Events.fire('files-selected', {
            files: files,
            to: this._peer.id
        });
        $input.value = null; // reset input
        this.setProgress(0.01);
    }

    setProgress(progress) {
        if (progress > 0) {
            this.$el.setAttribute('transfer', '1');
        }
        if (progress > 0.5) {
            this.$progress.classList.add('over50');
        } else {
            this.$progress.classList.remove('over50');
        }
        const degrees = `rotate(${360 * progress}deg)`;
        this.$progress.style.setProperty('--progress', degrees);
        if (progress >= 1) {
            this.setProgress(0);
            this.$el.removeAttribute('transfer');
        }
    }

    _onDrop(e) {
        e.preventDefault();
        const files = e.dataTransfer.files;
        Events.fire('files-selected', {
            files: files,
            to: this._peer.id
        });
        this._onDragEnd();
    }

    _onDragOver() {
        this.$el.setAttribute('drop', 1);
    }

    _onDragEnd() {
        this.$el.removeAttribute('drop');
    }

    _onRightClick(e) {
        e.preventDefault();
        Events.fire('text-recipient', this._peer.id);
    }

    _onTouchStart(e) {
        if (window.shareTargetFile) {
            // this is a ShareTarget flow
            Events.fire('files-selected', {
                files: [window.shareTargetFile],
                to: this._peer.id
            });
            window.shareTargetFile = null;
            e.preventDefault();
        } else {
            this._touchStart = Date.now();
            this._touchTimer = setTimeout(_ => this._onTouchEnd(), 610);
        }
    }

    _onTouchEnd(e) {
        if (Date.now() - this._touchStart < 500) {
            clearTimeout(this._touchTimer);
        } else { // this was a long tap
            if (e) e.preventDefault();
            Events.fire('text-recipient', this._peer.id);
        }
    }
}


class Dialog {
    constructor(id) {
        this.$el = $(id);
        this.$el.querySelectorAll('[close]').forEach(el => el.addEventListener('click', e => this.hide()))
        this.$autoFocus = this.$el.querySelector('[autofocus]');
    }

    show() {
        this.$el.setAttribute('show', 1);
        if (this.$autoFocus) this.$autoFocus.focus();
    }

    hide() {
        this.$el.removeAttribute('show');
        document.activeElement.blur();
        window.blur();
    }
}

class ReceiveDialog extends Dialog {

    constructor() {
        super('receiveDialog');
        Events.on('file-received', e => {
            this._nextFile(e.detail);
            window.blop.play();
        });
        this._filesQueue = [];
    }

    _nextFile(nextFile) {
        if (nextFile) this._filesQueue.push(nextFile);
        if (this._busy) return;
        this._busy = true;
        const file = this._filesQueue.shift();
        this._displayFile(file);
    }

    _dequeueFile() {
        if (!this._filesQueue.length) { // nothing to do
            this._busy = false;
            return;
        }
        // dequeue next file
        setTimeout(_ => {
            this._busy = false;
            this._nextFile();
        }, 300);
    }

    _displayFile(file) {
        const $a = this.$el.querySelector('#download');
        const url = URL.createObjectURL(file.blob);
        $a.href = url;
        $a.download = file.name;

        this.$el.querySelector('#fileName').textContent = file.name;
        this.$el.querySelector('#fileSize').textContent = this._formatFileSize(file.size);
        this.show();

        if (window.isDownloadSupported) return;
        // fallback for iOS
        $a.target = '_blank';
        const reader = new FileReader();
        reader.onload = e => $a.href = reader.result;
        reader.readAsDataURL(file.blob);
    }

    _formatFileSize(bytes) {
        if (bytes >= 1e9) {
            return (Math.round(bytes / 1e8) / 10) + ' GB';
        } else if (bytes >= 1e6) {
            return (Math.round(bytes / 1e5) / 10) + ' MB';
        } else if (bytes > 1000) {
            return Math.round(bytes / 1000) + ' KB';
        } else {
            return bytes + ' Bytes';
        }
    }

    hide() {
        super.hide();
        this._dequeueFile();
    }
}


class SendTextDialog extends Dialog {
    constructor() {
        super('sendTextDialog');
        Events.on('text-recipient', e => this._onRecipient(e.detail))
        this.$text = this.$el.querySelector('#textInput');
        const button = this.$el.querySelector('form');
        button.addEventListener('submit', e => this._send(e));
    }

    _onRecipient(recipient) {
        this._recipient = recipient;
        this.show();
        this.$text.setSelectionRange(0, this.$text.value.length)
    }

<<<<<<< Updated upstream
=======
    _handleShareTargetText() {
        if (!window.shareTargetText) return;
        this.$text.value = window.shareTargetText;
        window.shareTargetText = '';
    }

>>>>>>> Stashed changes
    _send(e) {
        e.preventDefault();
        if (!this.$text.value) return;
        Events.fire('send-text', {
            to: this._recipient,
            text: this.$text.value
        });
    }
}

class ReceiveTextDialog extends Dialog {
    constructor() {
        super('receiveTextDialog');
        Events.on('text-received', e => this._onText(e.detail))
        this.$text = this.$el.querySelector('#text');
        const $copy = this.$el.querySelector('#copy');
        copy.addEventListener('click', _ => this._onCopy());
    }

    _onText(e) {
        this.$text.innerHTML = '';
        const text = e.text;
        if (isURL(text)) {
            const $a = document.createElement('a');
            $a.href = text;
            $a.target = '_blank';
            $a.textContent = text;
            this.$text.appendChild($a);
        } else {
            this.$text.textContent = text;
        }
        this.show();
        window.blop.play();
    }

    _onCopy() {
        if (!document.copy(this.$text.textContent)) return;
        Events.fire('notify-user', 'Copied to clipboard');
    }
}

class Toast extends Dialog {
    constructor() {
        super('toast');
        Events.on('notify-user', e => this._onNotfiy(e.detail));
    }

    _onNotfiy(message) {
        this.$el.textContent = message;
        this.show();
        setTimeout(_ => this.hide(), 3000);
    }
}


class Notifications {

    constructor() {
        // Check if the browser supports notifications
        if (!('Notification' in window)) return;

        // Check whether notification permissions have already been granted
        if (Notification.permission !== 'granted') {
            this.$button = $('notification');
            this.$button.removeAttribute('hidden');
            this.$button.addEventListener('click', e => this._requestPermission());
        }
        Events.on('text-received', e => this._messageNotification(e.detail.text));
        Events.on('file-received', e => this._downloadNotification(e.detail.name));
    }

    _requestPermission() {
        Notification.requestPermission(permission => {
            if (permission !== 'granted') {
                Events.fire('notify-user', Notifications.PERMISSION_ERROR || 'Error');
                return;
            }
            this._notify('Even more snappy sharing!');
            this.$button.setAttribute('hidden', 1);
        });
    }

    _notify(message, body) {
        const config = {
            body: body,
            icon: '/images/logo_transparent_128x128.png',
        }
        try {
            return new Notification(message, config);
        } catch (e) {
            // android doesn't support "new Notification" if service worker is installed
            if (!serviceWorker || !serviceWorker.showNotification) return;
            return serviceWorker.showNotification(message, config);
        }

    }

    _messageNotification(message) {
        if (isURL(message)) {
            const notification = this._notify(message, 'Click to open link');
            this._bind(notification, e => window.open(message, '_blank', null, true));
        } else {
            const notification = this._notify(message, 'Click to copy text');
            this._bind(notification, e => this._copyText(message, notification));
        }
    }

    _downloadNotification(message) {
        const notification = this._notify(message, 'Click to download');
        if (!window.isDownloadSupported) return;
        this._bind(notification, e => this._download(notification));
    }

    _download(notification) {
        document.querySelector('x-dialog [download]').click();
        notification.close();
    }

    _copyText(message, notification) {
        notification.close();
        if(!document.copy(message)) return;
        this._notify('Copied text to clipboard');
    }

    _bind(notification, handler) {
        if (notification.then) {
            notification.then(e => serviceWorker.getNotifications().then(notifications => {
                serviceWorker.addEventListener('notificationclick', handler);
            }));
        } else {
            notification.onclick = handler;
        }
    }
}

<<<<<<< Updated upstream
=======

class NetworkStatusUI {

    constructor() {
        window.addEventListener('offline', e => this._showOfflineMessage(), false);
        window.addEventListener('online', e => this._showOnlineMessage(), false);
        if (!navigator.onLine) this._showOfflineMessage();
    }

    _showOfflineMessage() {
        Events.fire('notify-user', 'You are offline');
    }

    _showOnlineMessage() {
        Events.fire('notify-user', 'You are back online');
    }
}


>>>>>>> Stashed changes
class Snapdrop {
    constructor() {
        const server = new ServerConnection();
        const peers = new PeersManager(server);
        const peersUI = new PeersUI();
        Events.on('load', e => {
            const receiveDialog = new ReceiveDialog();
            const sendTextDialog = new SendTextDialog();
            const receiveTextDialog = new ReceiveTextDialog();
            const toast = new Toast();
            const notifications = new Notifications();
<<<<<<< Updated upstream
=======
            const networkStatusUI = new NetworkStatusUI();
>>>>>>> Stashed changes
        })
    }
}

const snapdrop = new Snapdrop();

document.copy = text => {
    // A <span> contains the text to copy
    const span = document.createElement('span');
    span.textContent = text;
    span.style.whiteSpace = 'pre'; // Preserve consecutive spaces and newlines

    // Paint the span outside the viewport
    span.style.position = 'absolute';
    span.style.left = '-9999px';
    span.style.top = '-9999px';

    const win = window;
    const selection = win.getSelection();
    win.document.body.appendChild(span);

    const range = win.document.createRange();
    selection.removeAllRanges();
    range.selectNode(span);
    selection.addRange(range);

    let success = false;
    try {
        success = win.document.execCommand('copy');
    } catch (err) {}

    selection.removeAllRanges();
    span.remove();

    return success;
}


if ('serviceWorker' in navigator && !window.iOS) {
    // SW on iOS is buggy. see: https://stackoverflow.com/questions/18103103/failed-to-load-resource-plugin-handled-load-on-ios
    navigator.serviceWorker
        .register('/service-worker.js')
        .then(serviceWorker => {
            console.log('Service Worker registered');
            window.serviceWorker = serviceWorker
        });
<<<<<<< Updated upstream
=======

    // don't display install banner when installed
    window.addEventListener('beforeinstallprompt', e => {
        if (window.matchMedia('(display-mode: standalone)').matches) {
            return event.preventDefault();
        }
    });

    navigator.serviceWorker.onmessage = (event) => {
        const shareTargetText = event.data.shareTargetText;
        window.shareTargetText = shareTargetText;
        console.log(shareTargetText);

        const shareTargetFile = event.data.shareTargetFile;
        window.shareTargetFile = shareTargetFile;
        console.log(shareTargetFile);
    };
>>>>>>> Stashed changes
}

// Background Animation
Events.on('load', () => {
    var requestAnimFrame = (function() {
        return window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame || window.oRequestAnimationFrame || window.msRequestAnimationFrame ||
            function(callback) {
                window.setTimeout(callback, 1000 / 60);
            };
    })();
    var c = document.createElement('canvas');
    document.body.appendChild(c);
    var style = c.style;
    style.width = '100%';
    style.position = 'absolute';
    style.zIndex = -1;
    var ctx = c.getContext('2d');
    var x0, y0, w, h, dw;

    function init() {
        w = window.innerWidth;
        h = window.innerHeight;
        c.width = w;
        c.height = h;
        var offset = h > 380 ? 100 : 65;
        x0 = w / 2;
        y0 = h - offset;
        dw = Math.max(w, h, 1000) / 13;
        drawCircles();
    }
    window.onresize = init;

    function drawCicrle(radius) {
        ctx.beginPath();
        var color = Math.round(255 * (1 - radius / Math.max(w, h)));
        ctx.strokeStyle = 'rgba(' + color + ',' + color + ',' + color + ',0.1)';
        ctx.arc(x0, y0, radius, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.lineWidth = 2;
    }

    var step = 0;

    function drawCircles() {
        ctx.clearRect(0, 0, w, h);
        for (var i = 0; i < 8; i++) {
            drawCicrle(dw * i + step % dw);
        }
        step += 1;
    }

    var loading = true;

    function animate() {
        if (loading || step % dw < dw - 5) {
            requestAnimFrame(function() {
                drawCircles();
                animate();
            });
        }
    }
    window.animateBackground = function(l) {
        loading = l;
        animate();
    };
    init();
    animate();
    setTimeout(e => window.animateBackground(false), 3000);
});

Notifications.PERMISSION_ERROR = `
Notifications permission has been blocked 
as the user has dismissed the permission prompt several times. 
This can be reset in Page Info 
which can be accessed by clicking the lock icon next to the URL.`;

document.body.onclick = e => { // safari hack to fix audio 
    document.body.onclick = null;
    if (!(/.*Version.*Safari.*/.test(navigator.userAgent))) return;
    blop.play();
}
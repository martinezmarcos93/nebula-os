// Nebula Shell - meters del sistema en la sidebar (incremento 3). Reproduce el
// bloque "SISTEMA" de la imagen objetivo: CPU / RAM / SWAP / GPU / Disco / Red
// + una sparkline de red.
//
// Fuentes (sin dependencias externas salvo nvidia-smi para la GPU):
//   CPU    /proc/stat        (delta busy/total entre lecturas)
//   RAM    /proc/meminfo     (MemTotal - MemAvailable)
//   SWAP   /proc/meminfo     (SwapTotal - SwapFree)
//   GPU    nvidia-smi        (async; si falla, la fila no se muestra)
//   Disco  Gio filesystem    (query_filesystem_info sobre /)
//   Red    /proc/net/dev     (delta bytes, todas las ifaces menos lo)
//
// Poll cada 2 s. Todo se limpia en destroy().

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

void Cairo;   // asegura la carga del modulo cairo para St.DrawingArea

const POLL_S = 2;
const SPARK_SAMPLES = 48;
const DISK_PATH = '/';

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder('utf-8').decode(bytes) : '';
    } catch (_e) {
        return '';
    }
}

function fmtBytes(n) {
    if (!isFinite(n) || n < 0)
        return '-';
    const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
}

function fmtRate(bytesPerSec) {
    if (bytesPerSec < 1024)
        return `${bytesPerSec.toFixed(0)} B/s`;
    if (bytesPerSec < 1024 * 1024)
        return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export class NebulaMeters {
    constructor() {
        this._pollId = 0;
        this._gpuCancel = null;
        this._prevCpu = null;
        this._prevNet = null;
        this._prevT = 0;
        this._spark = new Array(SPARK_SAMPLES).fill(0);
        this._sparkMax = 1;
        this._rows = {};

        this._widget = new St.BoxLayout({vertical: true, style_class: 'nebula-meters'});
        this._widget.add_child(new St.Label({text: 'SISTEMA', style_class: 'nebula-section'}));

        this._rows.cpu = this._addBarRow('CPU');
        this._rows.ram = this._addBarRow('RAM');
        this._rows.swap = this._addBarRow('SWAP');
        this._rows.gpu = this._addBarRow('GPU');
        this._gpuSub = new St.Label({text: '', style_class: 'nebula-meter-sub'});
        this._widget.add_child(this._gpuSub);
        this._rows.gpu.box.hide();
        this._gpuSub.hide();
        this._rows.disk = this._addBarRow('Disco');

        this._net = new St.Label({text: 'Red   -', style_class: 'nebula-net'});
        this._widget.add_child(this._net);

        this._sparkArea = new St.DrawingArea({
            style_class: 'nebula-spark',
            height: 34,
            x_expand: true,
        });
        this._sparkRepaintId = this._sparkArea.connect('repaint', () => this._drawSpark());
        this._widget.add_child(this._sparkArea);
    }

    get actor() {
        return this._widget;
    }

    start() {
        this._poll();
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_S, () => {
            this._poll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // --- filas -----------------------------------------------------

    _addBarRow(name) {
        const box = new St.BoxLayout({vertical: true, style_class: 'nebula-meter'});
        const head = new St.BoxLayout({style_class: 'nebula-meter-head'});
        const nameLbl = new St.Label({text: name, style_class: 'nebula-meter-name'});
        const valueLbl = new St.Label({
            text: '', style_class: 'nebula-meter-value', x_expand: true,
        });
        head.add_child(nameLbl);
        head.add_child(valueLbl);
        box.add_child(head);

        const track = new St.Widget({style_class: 'nebula-meter-track', height: 4});
        const fill = new St.Widget({style_class: 'nebula-meter-fill'});
        fill.set_pivot_point(0, 0);
        fill.add_constraint(new Clutter.BindConstraint({
            source: track,
            coordinate: Clutter.BindCoordinate.SIZE,
        }));
        track.add_child(fill);
        box.add_child(track);
        this._widget.add_child(box);

        return {box, value: valueLbl, fill};
    }

    _setBar(row, frac, text) {
        row.value.set_text(text);
        row.fill.scale_x = Math.max(0, Math.min(1, frac));
    }

    // --- lectura -------------------------------------------------

    _poll() {
        const now = GLib.get_monotonic_time() / 1e6;
        const dt = this._prevT ? Math.max(0.1, now - this._prevT) : POLL_S;
        this._prevT = now;

        this._pollCpu();
        this._pollMem();
        this._pollDisk();
        this._pollNet(dt);
        this._pollGpu();
    }

    _pollCpu() {
        const line = readText('/proc/stat').split('\n')[0];
        const p = line.trim().split(/\s+/).slice(1).map(Number);
        if (p.length < 4)
            return;
        const idle = (p[3] || 0) + (p[4] || 0);
        const total = p.reduce((a, b) => a + b, 0);
        if (this._prevCpu) {
            const dTotal = total - this._prevCpu.total;
            const dIdle = idle - this._prevCpu.idle;
            const frac = dTotal > 0 ? (dTotal - dIdle) / dTotal : 0;
            this._setBar(this._rows.cpu, frac, `${Math.round(frac * 100)}%`);
        }
        this._prevCpu = {idle, total};
    }

    _pollMem() {
        const m = {};
        for (const l of readText('/proc/meminfo').split('\n')) {
            const mm = l.match(/^(\w+):\s+(\d+)/);
            if (mm)
                m[mm[1]] = parseInt(mm[2], 10) * 1024;
        }
        if (m.MemTotal) {
            const used = m.MemTotal - (m.MemAvailable ?? m.MemFree ?? 0);
            this._setBar(this._rows.ram, used / m.MemTotal,
                `${fmtBytes(used)} / ${fmtBytes(m.MemTotal)}`);
        }
        if (m.SwapTotal > 0) {
            const su = m.SwapTotal - (m.SwapFree ?? 0);
            this._setBar(this._rows.swap, su / m.SwapTotal, `${Math.round(su / m.SwapTotal * 100)}%`);
        } else {
            this._setBar(this._rows.swap, 0, '0%');
        }
    }

    _pollDisk() {
        try {
            const info = Gio.File.new_for_path(DISK_PATH)
                .query_filesystem_info('filesystem::size,filesystem::used', null);
            const size = info.get_attribute_uint64('filesystem::size');
            const used = info.get_attribute_uint64('filesystem::used');
            if (size > 0)
                this._setBar(this._rows.disk, used / size,
                    `${fmtBytes(used)} / ${fmtBytes(size)}`);
        } catch (_e) { /* sin permiso / fs raro */ }
    }

    _pollNet(dt) {
        let rx = 0, tx = 0;
        for (const l of readText('/proc/net/dev').split('\n')) {
            const mm = l.match(/^\s*([\w.-]+):\s+(\d+)(?:\s+\d+){7}\s+(\d+)/);
            if (mm && mm[1] !== 'lo') {
                rx += parseInt(mm[2], 10);
                tx += parseInt(mm[3], 10);
            }
        }
        if (this._prevNet) {
            const drx = Math.max(0, rx - this._prevNet.rx) / dt;
            const dtx = Math.max(0, tx - this._prevNet.tx) / dt;
            this._net.set_text(`Red   ↓ ${fmtRate(drx)}   ↑ ${fmtRate(dtx)}`);
            this._spark.push(drx + dtx);
            this._spark.shift();
            this._sparkMax = Math.max(1, ...this._spark);
            this._sparkArea.queue_repaint();
        }
        this._prevNet = {rx, tx};
    }

    _pollGpu() {
        if (this._gpuCancel)
            return;
        let sub;
        try {
            sub = Gio.Subprocess.new(
                ['nvidia-smi',
                    '--query-gpu=utilization.gpu,memory.used,memory.total,name',
                    '--format=csv,noheader,nounits'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (_e) {
            return;   // nvidia-smi no esta -> fila GPU oculta
        }
        this._gpuCancel = new Gio.Cancellable();
        sub.communicate_utf8_async(null, this._gpuCancel, (proc, res) => {
            this._gpuCancel = null;
            let out = '';
            try {
                [, out] = proc.communicate_utf8_finish(res);
            } catch (_e) {
                return;
            }
            const parts = out.trim().split(',').map(s => s.trim());
            if (parts.length < 4)
                return;
            const util = parseFloat(parts[0]);
            const memU = parseFloat(parts[1]);
            const memT = parseFloat(parts[2]);
            const name = parts[3];
            this._rows.gpu.box.show();
            this._gpuSub.show();
            this._setBar(this._rows.gpu, util / 100, `${Math.round(util)}%`);
            this._gpuSub.set_text(
                `${name} · ${fmtBytes(memU * 1024 * 1024)} / ${fmtBytes(memT * 1024 * 1024)}`);
        });
    }

    // --- sparkline ---------------------------------------------

    _drawSpark() {
        let cr;
        try {
            const [w, h] = this._sparkArea.get_surface_size();
            cr = this._sparkArea.get_context();
            cr.setSourceRGBA(0.49, 0.36, 0.93, 0.9);   // violeta
            cr.setLineWidth(1.5);
            const n = this._spark.length;
            for (let i = 0; i < n; i++) {
                const x = (i / (n - 1)) * w;
                const y = h - (this._spark[i] / this._sparkMax) * (h - 2) - 1;
                if (i === 0)
                    cr.moveTo(x, y);
                else
                    cr.lineTo(x, y);
            }
            cr.stroke();
        } catch (_e) {
            // Cairo puede fallar en captura de thumbnail; ignorar.
        } finally {
            cr?.$dispose?.();
        }
    }

    destroy() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        if (this._gpuCancel) {
            this._gpuCancel.cancel();
            this._gpuCancel = null;
        }
        if (this._sparkRepaintId) {
            this._sparkArea.disconnect(this._sparkRepaintId);
            this._sparkRepaintId = 0;
        }
        this._widget?.destroy();
        this._widget = null;
        this._rows = {};
    }
}

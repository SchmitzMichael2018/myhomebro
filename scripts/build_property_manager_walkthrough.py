"""Build the narrated Property Manager product walkthrough.

Requires OPENAI_API_KEY, Pillow, imageio-ffmpeg, and the production screenshots
created by the QA capture workflow. The generated MP4, poster, captions, and
transcript replace the property-manager assets used by ProductOverviewModal.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import urllib.request
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps
import imageio_ffmpeg


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "frontend" / "src" / "assets" / "product-overview"
LOGO_PATH = ROOT / "frontend" / "src" / "assets" / "myhomebro_logo.png"
DEFAULT_CAPTURE_DIR = ROOT / ".tmp" / "property-manager-walkthrough-captures"
BUILD_DIR = ROOT / ".tmp" / "property-manager-walkthrough-build"

TITLE = "From resident request to permanent property record"
DESCRIPTION = (
    "A property-management tour of resident intake, manager review, vendor "
    "coordination, completion evidence, and lasting maintenance history."
)

SEGMENTS = [
    {
        "image": None,
        "eyebrow": "MYHOMEBRO FOR PROPERTY OPERATIONS",
        "title": TITLE,
        "description": "One connected maintenance workflow for residents, managers, and vendors.",
        "narration": (
            "Welcome to MyHomeBro property operations. Here is how a resident maintenance need "
            "moves from first report to a complete, permanent property record."
        ),
    },
    {
        "image": "01-operations.png",
        "eyebrow": "1 · OPERATIONS",
        "title": "See what needs attention first",
        "description": "Requests, active work, responsible parties, and property context share one command center.",
        "narration": (
            "The Property Manager Portal opens with a portfolio command center. Open requests, active work orders, "
            "properties, units, tenants, and preferred vendors are visible together, so the next action is clear."
        ),
    },
    {
        "image": "07-resident-status.png",
        "eyebrow": "2 · RESIDENT INTAKE",
        "title": "Give residents a clear path to report and follow up",
        "description": "The resident can provide the issue, urgency, access details, comments, photos, and documents.",
        "narration": (
            "Residents can report the affected property and unit, describe the problem, set urgency, grant access, "
            "and attach helpful evidence. Their secure status page shows what happened without exposing the manager workspace."
        ),
    },
    {
        "image": "02-maintenance-history.png",
        "eyebrow": "3 · MANAGER REVIEW",
        "title": "Review facts before creating work",
        "description": "Request more information, approve valid work, document the decision, or close the request.",
        "narration": (
            "The manager reviews the facts and supporting files, requests more information when needed, records notes, "
            "and approves valid work. Closed requests stay available as read-only history instead of disappearing."
        ),
    },
    {
        "image": "03-work-order-closeout.png",
        "eyebrow": "4 · VENDOR COORDINATION",
        "title": "Connect the request to accountable work",
        "description": "Preferred vendors, MyHomeBro contractors, or internal staff can own the next step.",
        "narration": (
            "An approved request becomes a traceable work order. The manager can route it to a preferred vendor, "
            "a participating contractor, or internal staff while preserving the resident and source request context."
        ),
    },
    {
        "image": "04-scheduling-and-evidence.png",
        "eyebrow": "5 · SCHEDULE AND COMPLETE",
        "title": "Keep scheduling, notes, and evidence together",
        "description": "A scheduled visit, completion notes, photos, and files remain attached to the work order.",
        "narration": (
            "Scheduling uses clear date and time controls. During closeout, the manager can review completion notes, "
            "photos, receipts, or documents before marking the work complete and closing the maintenance request."
        ),
    },
    {
        "image": "05-properties.png",
        "eyebrow": "6 · PROPERTY RECORD",
        "title": "Preserve the operational history by property and unit",
        "description": "Buildings, units, tenants, vendors, systems, and completed maintenance remain connected.",
        "narration": (
            "The property record connects each building with its units, tenants, vendors, systems, and completed maintenance. "
            "That history gives future decisions better context and keeps recurring issues easier to recognize."
        ),
    },
    {
        "image": "06-updates.png",
        "eyebrow": "7 · TRACEABLE UPDATES",
        "title": "Know what changed and what is finished",
        "description": "Notifications and history distinguish new actions from completed records.",
        "narration": (
            "Updates keep important changes visible, while finished requests and work orders move out of the active queue. "
            "Property teams can confirm what is pending, who is responsible, and what has already been completed."
        ),
    },
    {
        "image": None,
        "eyebrow": "MYHOMEBRO PROPERTY OPERATIONS",
        "title": "From maintenance request to property intelligence",
        "description": "Review, coordinate, complete, and preserve every authorized maintenance record.",
        "narration": (
            "MyHomeBro gives residents a clear reporting path and gives property teams an accountable workflow, "
            "from maintenance request to permanent property intelligence."
        ),
    },
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def wrap(draw: ImageDraw.ImageDraw, text: str, text_font: ImageFont.ImageFont, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=text_font)[2] <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def render_title_slide(segment: dict, destination: Path, *, closing: bool = False) -> None:
    canvas = Image.new("RGB", (1920, 1080), "#020b1c")
    draw = ImageDraw.Draw(canvas)
    for radius, color in [(720, "#082c56"), (480, "#07366c"), (260, "#0b4b86")]:
        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        layer_draw = ImageDraw.Draw(layer)
        layer_draw.ellipse((1360 - radius, 170 - radius, 1360 + radius, 170 + radius), fill=color)
        canvas = Image.alpha_composite(canvas.convert("RGBA"), layer.filter(ImageFilter.GaussianBlur(radius // 3)))
    draw = ImageDraw.Draw(canvas)
    if closing:
        logo = Image.open(LOGO_PATH).convert("RGB")
        logo = ImageOps.fit(logo, (430, 430), method=Image.Resampling.LANCZOS)
        shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow)
        shadow_draw.rounded_rectangle((745, 122, 1175, 552), radius=48, fill=(0, 0, 0, 150))
        canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(24)))
        canvas.paste(logo, (745, 112))
        draw = ImageDraw.Draw(canvas)
        draw.text((960, 620), "Plan clearly. Work confidently. Keep the record.", font=font(35, True), fill="#ffffff", anchor="mm")
        draw.rounded_rectangle((715, 710, 1205, 792), radius=24, fill="#2563eb")
        draw.text((960, 751), "myhomebro.com", font=font(30, True), fill="#ffffff", anchor="mm")
        destination.parent.mkdir(parents=True, exist_ok=True)
        canvas.convert("RGB").save(destination, quality=96)
        return

    draw.text((180, 260), segment["eyebrow"], font=font(24, True), fill="#fcd34d")
    y = 325
    for line in wrap(draw, segment["title"], font(72, True), 1180):
        draw.text((180, y), line, font=font(72, True), fill="#ffffff")
        y += 84
    y += 24
    for line in wrap(draw, segment["description"], font(30), 1060):
        draw.text((180, y), line, font=font(30), fill="#cbd5e1")
        y += 43
    draw.rounded_rectangle((180, 820, 510, 890), radius=20, fill="#2563eb")
    draw.text((235, 838), "myhomebro.com", font=font(25, True), fill="#ffffff")
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(destination, quality=96)


def render_product_slide(segment: dict, source: Path, destination: Path) -> None:
    shot = Image.open(source).convert("RGB")
    shot = ImageOps.fit(shot, (1920, 1080), method=Image.Resampling.LANCZOS)
    shot = ImageEnhance.Brightness(shot).enhance(0.82)
    canvas = shot.convert("RGBA")
    shade = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shade_draw = ImageDraw.Draw(shade)
    shade_draw.rectangle((0, 710, 1920, 1080), fill=(2, 8, 23, 205))
    shade_draw.rectangle((0, 0, 1920, 1080), outline=(56, 189, 248, 80), width=4)
    canvas = Image.alpha_composite(canvas, shade)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((120, 745, 1800, 1015), radius=28, fill=(2, 15, 35, 235), outline=(56, 189, 248, 105), width=2)
    draw.text((175, 790), segment["eyebrow"], font=font(23, True), fill="#fcd34d")
    draw.text((175, 835), segment["title"], font=font(43, True), fill="#ffffff")
    y = 905
    for line in wrap(draw, segment["description"], font(27), 1510):
        draw.text((175, y), line, font=font(27), fill="#dbeafe")
        y += 38
    canvas.convert("RGB").save(destination, quality=96)


def create_speech(text: str, destination: Path, speed: float) -> None:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")
    payload = json.dumps(
        {
            "model": "gpt-4o-mini-tts",
            "voice": "marin",
            "input": text,
            "instructions": (
                "Warm, confident American narration for a polished software walkthrough. "
                "Sound natural and conversational, with brief pauses between ideas. Avoid a salesy tone."
            ),
            "response_format": "wav",
            "speed": speed,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://api.openai.com/v1/audio/speech",
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        destination.write_bytes(response.read())


def timestamp(seconds: float) -> str:
    milliseconds = int(round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:03d}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--captures", type=Path, default=DEFAULT_CAPTURE_DIR)
    parser.add_argument("--speed", type=float, default=0.9)
    parser.add_argument("--reuse-audio", action="store_true")
    args = parser.parse_args()

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    frames_dir = BUILD_DIR / "frames"
    audio_dir = BUILD_DIR / "audio"
    frames_dir.mkdir(exist_ok=True)
    audio_dir.mkdir(exist_ok=True)

    durations: list[float] = []
    audio_paths: list[Path] = []
    frame_paths: list[Path] = []
    for index, segment in enumerate(SEGMENTS):
        frame_path = frames_dir / f"{index:02d}.jpg"
        if segment["image"]:
            source = args.captures / segment["image"]
            if not source.exists():
                raise FileNotFoundError(source)
            render_product_slide(segment, source, frame_path)
        else:
            render_title_slide(segment, frame_path, closing=index == len(SEGMENTS) - 1)
        frame_paths.append(frame_path)

        audio_path = audio_dir / f"{index:02d}.wav"
        if not (args.reuse_audio and audio_path.exists()):
            create_speech(segment["narration"], audio_path, args.speed)
        with wave.open(str(audio_path), "rb") as audio:
            pcm = audio.readframes(audio.getnframes())
            durations.append(len(pcm) / (audio.getframerate() * audio.getsampwidth() * audio.getnchannels()) + 0.65)
        audio_paths.append(audio_path)

    combined_audio = BUILD_DIR / "narration.wav"
    with wave.open(str(audio_paths[0]), "rb") as first:
        params = first.getparams()
        audio_signature = (params.nchannels, params.sampwidth, params.framerate, params.comptype)
    with wave.open(str(combined_audio), "wb") as output:
        output.setnchannels(params.nchannels)
        output.setsampwidth(params.sampwidth)
        output.setframerate(params.framerate)
        output.setcomptype(params.comptype, params.compname)
        for audio_path in audio_paths:
            with wave.open(str(audio_path), "rb") as audio:
                current = audio.getparams()
                if (current.nchannels, current.sampwidth, current.framerate, current.comptype) != audio_signature:
                    raise RuntimeError("Narration WAV parameters do not match.")
                output.writeframes(audio.readframes(audio.getnframes()))
                output.writeframes(b"\x00" * int(params.framerate * 0.65) * params.sampwidth * params.nchannels)

    concat_path = BUILD_DIR / "frames.txt"
    concat_lines: list[str] = []
    for frame_path, duration in zip(frame_paths, durations):
        concat_lines.extend([f"file '{frame_path.as_posix()}'", f"duration {duration:.3f}"])
    concat_path.write_text("\n".join(concat_lines), encoding="utf-8")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    silent_video = BUILD_DIR / "silent.mp4"
    subprocess.run(
        [
            ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_path),
            "-vf", "fps=25,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-movflags", "+faststart", str(silent_video),
        ],
        check=True,
    )

    output_video = ASSET_DIR / "myhomebro-property-manager-walkthrough.mp4"
    subprocess.run(
        [
            ffmpeg, "-y", "-i", str(silent_video), "-i", str(combined_audio),
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
            str(output_video),
        ],
        check=True,
    )

    poster = Image.open(frame_paths[0]).convert("RGB")
    poster.save(ASSET_DIR / "myhomebro-property-manager-walkthrough-poster.jpg", quality=92, optimize=True)

    transcript_lines = [TITLE, "", DESCRIPTION, ""]
    transcript_lines.extend(segment["narration"] for segment in SEGMENTS)
    (ASSET_DIR / "myhomebro-property-manager-walkthrough.txt").write_text(
        "\n\n".join(transcript_lines).strip() + "\n", encoding="utf-8"
    )

    cursor = 0.0
    captions = ["WEBVTT", ""]
    for segment, duration in zip(SEGMENTS, durations):
        speech_duration = max(0.1, duration - 0.65)
        captions.extend(
            [
                f"{timestamp(cursor)} --> {timestamp(cursor + speech_duration)}",
                segment["narration"],
                "",
            ]
        )
        cursor += duration
    (ASSET_DIR / "myhomebro-property-manager-walkthrough.vtt").write_text(
        "\n".join(captions), encoding="utf-8"
    )

    print(json.dumps({"video": str(output_video), "duration_seconds": round(cursor, 2)}, indent=2))


if __name__ == "__main__":
    main()

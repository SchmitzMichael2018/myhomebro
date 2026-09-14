"""Append a consistent five-second MyHomeBro closing card to walkthrough MP4s."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "frontend" / "src" / "assets" / "product-overview"
LOGO_PATH = ROOT / "frontend" / "src" / "assets" / "myhomebro_logo.png"
VIDEO_NAMES = (
    "myhomebro-contractor-walkthrough.mp4",
    "myhomebro-homeowner-walkthrough.mp4",
    "myhomebro-property-manager-walkthrough.mp4",
)
OUTRO_MARKER = "MyHomeBro branded outro v1"


def font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = (
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
            if bold
            else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        ),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def render_outro(destination: Path) -> None:
    canvas = Image.new("RGBA", (1920, 1080), "#020b1c")
    for radius, color in ((760, "#082c56"), (510, "#07366c"), (290, "#0b4b86")):
        glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse(
            (960 - radius, 350 - radius, 960 + radius, 350 + radius),
            fill=color,
        )
        canvas = Image.alpha_composite(canvas, glow.filter(ImageFilter.GaussianBlur(radius // 3)))

    logo = Image.open(LOGO_PATH).convert("RGB")
    logo = ImageOps.fit(logo, (470, 470), method=Image.Resampling.LANCZOS)
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((725, 82, 1195, 552), radius=54, fill=(0, 0, 0, 160))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(28)))
    canvas.paste(logo, (725, 70))

    draw = ImageDraw.Draw(canvas)
    draw.text(
        (960, 638),
        "Plan clearly. Work confidently. Keep the record.",
        font=font(38, bold=True),
        fill="#ffffff",
        anchor="mm",
    )
    draw.rounded_rectangle((700, 730, 1220, 820), radius=26, fill="#2563eb")
    draw.text((960, 775), "myhomebro.com", font=font(32, bold=True), fill="#ffffff", anchor="mm")
    draw.text(
        (960, 905),
        "Projects, payments, and property records—all connected.",
        font=font(25),
        fill="#bfdbfe",
        anchor="mm",
    )
    canvas.convert("RGB").save(destination, quality=96)


def append_outro(ffmpeg: str, source: Path, outro_image: Path, destination: Path) -> None:
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-loop",
            "1",
            "-t",
            "5",
            "-i",
            str(outro_image),
            "-f",
            "lavfi",
            "-t",
            "5",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-filter_complex",
            (
                "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
                "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25[v0];"
                "[1:v]scale=1920:1080,setsar=1,fps=25,fade=t=in:st=0:d=0.45[v1];"
                "[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];"
                "[2:a]aformat=sample_fmts=fltp:channel_layouts=stereo[a1];"
                "[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"
            ),
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-metadata",
            f"comment={OUTRO_MARKER}",
            str(destination),
        ],
        check=True,
    )


def already_branded(ffmpeg: str, source: Path) -> bool:
    probe = subprocess.run(
        [ffmpeg, "-i", str(source)],
        capture_output=True,
        check=False,
        text=True,
    )
    return OUTRO_MARKER in probe.stderr


def main() -> None:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory(prefix="myhomebro-walkthrough-outro-") as temp_name:
        temp_dir = Path(temp_name)
        outro_image = temp_dir / "outro.jpg"
        render_outro(outro_image)
        for video_name in VIDEO_NAMES:
            source = ASSET_DIR / video_name
            if already_branded(ffmpeg, source):
                print(f"Skipped already branded {source}")
                continue
            output = temp_dir / video_name
            append_outro(ffmpeg, source, outro_image, output)
            shutil.copy2(output, source)
            print(f"Updated {source}")


if __name__ == "__main__":
    main()

"""Build the first two narrated MyHomeBro onboarding how-to videos.

Requires OPENAI_API_KEY, Pillow, and imageio-ffmpeg. Run the companion
capture_onboarding_howto.mjs script first so all product screens use safe demo
data rather than a production account.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import wave
from pathlib import Path

import imageio_ffmpeg
from PIL import Image

from build_property_manager_walkthrough import (
    create_speech,
    render_product_slide,
    render_title_slide,
    timestamp,
)


ROOT = Path(__file__).resolve().parents[1]
CAPTURE_DIR = ROOT / ".tmp" / "onboarding-howto-captures"
BUILD_ROOT = ROOT / ".tmp" / "onboarding-howto-build"
ASSET_DIR = ROOT / "frontend" / "src" / "assets" / "how-to"

VIDEOS = (
    {
        "slug": "myhomebro-create-profile-howto",
        "title": "Create Your Contractor Profile",
        "description": "Set up the business details MyHomeBro uses to organize your work.",
        "segments": (
            {
                "image": None,
                "eyebrow": "MYHOMEBRO HOW-TO · ONBOARDING",
                "title": "Create Your Contractor Profile",
                "description": "Add your account, services, and business setup with review at every step.",
                "narration": "Welcome to MyHomeBro. In this quick walkthrough, you will create your contractor account and set up a useful business profile.",
            },
            {
                "image": "profile-01-signup.png",
                "eyebrow": "1 · CREATE YOUR ACCOUNT",
                "title": "Start with your real contact information",
                "description": "Use an email and phone number you control, create a strong password, and review the terms before continuing.",
                "narration": "Begin by entering your name, an email and phone number you control, and a strong password. Review the Terms and Privacy Policy, then create the account.",
            },
            {
                "image": "profile-02-welcome.png",
                "eyebrow": "2 · START YOUR SETUP",
                "title": "MyHomeBro builds from the way you work",
                "description": "Your answers create editable starting points. They do not publish or send anything automatically.",
                "narration": "Select Get started. Your answers help MyHomeBro prepare editable project and workflow defaults. Nothing is published or sent automatically.",
            },
            {
                "image": "profile-03-services.png",
                "eyebrow": "3 · DESCRIBE YOUR SERVICES",
                "title": "Use plain language and be specific",
                "description": "Include your main trades, common project types, and the work you want customers to find you for.",
                "narration": "Describe the work you usually perform in plain language. Include your main trades and common project types so the suggested setup fits your business.",
            },
            {
                "image": "profile-04-business-details.png",
                "eyebrow": "4 · CONFIRM BUSINESS DETAILS",
                "title": "Set the service area and working preferences",
                "description": "Review business type, service radius, credentials, insurance, and emergency-service availability.",
                "narration": "Next, review your business type, service area, and operating details. Only claim licenses, insurance, or emergency availability that accurately apply to your business.",
            },
            {
                "image": "profile-05-review.png",
                "eyebrow": "5 · REVIEW BEFORE ACCEPTING",
                "title": "Keep only the setup that fits",
                "description": "Check the suggested workflow, pricing baseline, and project defaults before accepting them.",
                "narration": "Review the suggested workflow, pricing baseline, and project defaults. These are starting points, so confirm they fit your work before selecting Looks good.",
            },
            {
                "image": None,
                "eyebrow": "PROFILE READY",
                "title": "Your profile can grow with your business",
                "description": "Return to Profile whenever your services, contact details, or service area change.",
                "narration": "Your initial profile is ready. You can return to Profile whenever your services, contact information, or service area changes.",
                "closing": True,
            },
        ),
    },
    {
        "slug": "myhomebro-connect-stripe-howto",
        "title": "Connect Stripe and Get Paid",
        "description": "Complete secure contractor payment onboarding inside MyHomeBro.",
        "segments": (
            {
                "image": None,
                "eyebrow": "MYHOMEBRO HOW-TO · PAYMENTS",
                "title": "Connect Stripe and Get Paid",
                "description": "Securely verify your business and enable customer payments and payouts.",
                "narration": "This walkthrough shows contractors how to connect Stripe securely so they can accept customer payments and receive payouts through MyHomeBro.",
            },
            {
                "image": "stripe-01-secure-setup.png",
                "eyebrow": "1 · OPEN PAYMENT SETUP",
                "title": "Complete Stripe onboarding securely",
                "description": "Stripe collects the business, identity, and payout information required for payment processing.",
                "narration": "Open Stripe Onboarding from MyHomeBro. Stripe securely collects the business, identity, and payout details required for payment processing.",
            },
            {
                "image": "stripe-01-secure-setup.png",
                "eyebrow": "2 · USE ACCURATE INFORMATION",
                "title": "Verify the real person and business",
                "description": "Enter legal business details, identity information, and a payout bank account you control.",
                "narration": "Enter accurate legal business and identity information, then connect a payout bank account you control. Never use fictional details in a live Stripe account.",
            },
            {
                "image": "stripe-01-secure-setup.png",
                "eyebrow": "3 · REVIEW BEFORE SUBMITTING",
                "title": "Check each required section",
                "description": "Stripe may request supporting information. Keep sensitive details inside the secure Stripe component.",
                "narration": "Review each required section before submitting. Stripe may ask for supporting information. Keep bank, tax, and identity details inside the secure Stripe form.",
            },
            {
                "image": "stripe-02-complete.png",
                "eyebrow": "4 · CONFIRM PAYMENT READINESS",
                "title": "Look for charges and payouts enabled",
                "description": "MyHomeBro shows when the payment account is ready and whether Stripe still needs anything.",
                "narration": "After submission, return to MyHomeBro and confirm that charges and payouts are enabled. If Stripe needs more information, follow the status prompt to finish setup.",
            },
            {
                "image": None,
                "eyebrow": "PAYMENTS READY",
                "title": "Stripe is connected",
                "description": "You can now use eligible Direct Pay, protected funding, and progress-payment workflows.",
                "narration": "Once the account shows payment setup complete, Stripe is connected. You can now use eligible Direct Pay, protected funding, and progress payment workflows.",
                "closing": True,
            },
        ),
    },
)


def assemble_video(video: dict, *, speed: float, reuse_audio: bool) -> dict:
    slug = video["slug"]
    build_dir = BUILD_ROOT / slug
    frames_dir = build_dir / "frames"
    audio_dir = build_dir / "audio"
    frames_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)

    frame_paths: list[Path] = []
    audio_paths: list[Path] = []
    durations: list[float] = []
    for index, segment in enumerate(video["segments"]):
        frame_path = frames_dir / f"{index:02d}.jpg"
        if segment["image"]:
            source = CAPTURE_DIR / segment["image"]
            if not source.exists():
                raise FileNotFoundError(source)
            render_product_slide(segment, source, frame_path)
        else:
            render_title_slide(segment, frame_path, closing=bool(segment.get("closing")))
        frame_paths.append(frame_path)

        audio_path = audio_dir / f"{index:02d}.wav"
        if not (reuse_audio and audio_path.exists()):
            create_speech(segment["narration"], audio_path, speed)
        with wave.open(str(audio_path), "rb") as audio:
            pcm = audio.readframes(audio.getnframes())
            seconds = len(pcm) / (
                audio.getframerate() * audio.getsampwidth() * audio.getnchannels()
            )
            durations.append(seconds + 0.6)
        audio_paths.append(audio_path)

    combined_audio = build_dir / "narration.wav"
    with wave.open(str(audio_paths[0]), "rb") as first:
        params = first.getparams()
    with wave.open(str(combined_audio), "wb") as output:
        output.setnchannels(params.nchannels)
        output.setsampwidth(params.sampwidth)
        output.setframerate(params.framerate)
        output.setcomptype(params.comptype, params.compname)
        for audio_path in audio_paths:
            with wave.open(str(audio_path), "rb") as audio:
                output.writeframes(audio.readframes(audio.getnframes()))
                output.writeframes(
                    b"\x00"
                    * int(params.framerate * 0.6)
                    * params.sampwidth
                    * params.nchannels
                )

    concat_path = build_dir / "frames.txt"
    concat_lines: list[str] = []
    for frame_path, duration in zip(frame_paths, durations):
        concat_lines.extend(
            [f"file '{frame_path.as_posix()}'", f"duration {duration:.3f}"]
        )
    concat_lines.append(f"file '{frame_paths[-1].as_posix()}'")
    concat_path.write_text("\n".join(concat_lines), encoding="utf-8")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    silent_video = build_dir / "silent.mp4"
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_path),
            "-vf",
            "fps=25,format=yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-movflags",
            "+faststart",
            str(silent_video),
        ],
        check=True,
    )
    output_video = ASSET_DIR / f"{slug}.mp4"
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(silent_video),
            "-i",
            str(combined_audio),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(output_video),
        ],
        check=True,
    )

    Image.open(frame_paths[0]).convert("RGB").save(
        ASSET_DIR / f"{slug}-poster.jpg", quality=92, optimize=True
    )
    transcript = [video["title"], "", video["description"], ""]
    transcript.extend(segment["narration"] for segment in video["segments"])
    (ASSET_DIR / f"{slug}.txt").write_text(
        "\n\n".join(transcript).strip() + "\n", encoding="utf-8"
    )
    cursor = 0.0
    captions = ["WEBVTT", ""]
    for segment, duration in zip(video["segments"], durations):
        speech_duration = max(0.1, duration - 0.6)
        captions.extend(
            [
                f"{timestamp(cursor)} --> {timestamp(cursor + speech_duration)}",
                segment["narration"],
                "",
            ]
        )
        cursor += duration
    (ASSET_DIR / f"{slug}.vtt").write_text("\n".join(captions), encoding="utf-8")
    return {"video": str(output_video), "duration_seconds": round(cursor, 2)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--speed", type=float, default=0.96)
    parser.add_argument("--reuse-audio", action="store_true")
    args = parser.parse_args()
    results = [
        assemble_video(video, speed=args.speed, reuse_audio=args.reuse_audio)
        for video in VIDEOS
    ]
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()

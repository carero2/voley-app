"""Detección por trozos que se puede retomar (con un detector falso): python video/tests/test_pipeline.py"""

import os
import sys
import tempfile

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voley_cv import pipeline  # noqa: E402


class FakeDetector:
    calls = 0
    fail_after = None
    name, ball_tiles, device = "falso", (1, 1), "cpu"

    def __init__(self, **kwargs):
        pass

    def detect_batch(self, frames):
        FakeDetector.calls += len(frames)
        if FakeDetector.fail_after is not None and FakeDetector.calls > FakeDetector.fail_after:
            raise RuntimeError("sesión cortada")
        return [{"persons": [], "balls": []} for _ in frames]


def make_video(path, secs=5, fps=10):
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (64, 48))
    for _ in range(secs * fps):
        w.write(np.zeros((48, 64, 3), np.uint8))
    w.release()


def test_detect_chunked_resumes():
    pipeline.Detector = FakeDetector
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "v.mp4")
        make_video(video)
        folder = os.path.join(tmp, "det")
        FakeDetector.calls, FakeDetector.fail_after = 0, 25  # se corta en el tercer trozo
        try:
            pipeline.detect_chunked(video, folder, stride=1, chunk=1.0)
            raise AssertionError("debería haberse cortado")
        except RuntimeError:
            pass
        done = sorted(f for f in os.listdir(folder) if f.endswith(".jsonl"))
        assert len(done) == 2, done  # solo cuentan los trozos completos
        FakeDetector.calls, FakeDetector.fail_after = 0, None
        header, frames = pipeline.detect_chunked(video, folder, stride=1, chunk=1.0)
        assert FakeDetector.calls == 30, FakeDetector.calls  # no repite los trozos hechos
        assert [f["f"] for f in frames] == list(range(50))
        assert header["end_frame"] == 50


if __name__ == "__main__":
    test_detect_chunked_resumes()
    print("✓ test_detect_chunked_resumes")

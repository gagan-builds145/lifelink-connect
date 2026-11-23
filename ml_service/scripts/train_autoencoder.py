"""Train the TensorFlow/Keras inventory autoencoder on synthetic normal patterns."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deep_training import DeepDependencyError, SERVICE_ROOT, train_autoencoder  # noqa: E402


if __name__ == "__main__":
    try:
        train_autoencoder(SERVICE_ROOT / "artifacts")
    except DeepDependencyError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)

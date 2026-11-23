"""Train ANN, LSTM and Autoencoder deep models on the labelled synthetic datasets."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deep_training import (  # noqa: E402
    DeepDependencyError,
    SERVICE_ROOT,
    train_all_deep,
)


if __name__ == "__main__":
    try:
        print(json.dumps(train_all_deep(SERVICE_ROOT / "artifacts"), indent=2))
    except DeepDependencyError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)

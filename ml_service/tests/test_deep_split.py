from __future__ import annotations

from scripts.deep_training import _chronological_split


def test_chronological_split_is_ordered_and_non_overlapping():
    train, validation, test = _chronological_split(100)
    assert (train.start, train.stop) == (0, 70)
    assert (validation.start, validation.stop) == (70, 85)
    assert (test.start, test.stop) == (85, 100)
    assert train.stop <= validation.start
    assert validation.stop <= test.start


def test_chronological_split_handles_small_series_without_overlap():
    for count in (3, 4, 10, 337):
        train, validation, test = _chronological_split(count)
        covered = train.stop + (validation.stop - validation.start) + (test.stop - test.start)
        assert covered == count
        assert train.stop <= validation.start <= validation.stop <= test.start


def test_chronological_split_rejects_too_short_series():
    try:
        _chronological_split(2)
    except ValueError as error:
        assert "three" in str(error).lower()
    else:
        raise AssertionError("Expected a ValueError for fewer than three observations")

"""No-key tests for the transcript checker (spec behaviors 1, 3, 4).

    .venv/bin/python -m pytest voice/tests/test_check.py -v     # from the repo root; no key, under a second
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check import compare, wer, words

SAID = "Hi, my name is Ralston Raphael. What did you build for CPSC 415 this semester?"   # 15 words


def test_words_ignore_case_and_punctuation():
    assert words("Hi, RALSTON!  It's 415.") == ["hi", "ralston", "it's", "415"]


def test_perfect_transcript_scores_zero():
    assert wer(SAID, SAID) == 0.0
    assert wer(SAID, "hi my name is ralston raphael what did you build for cpsc 415 this semester") == 0.0


def test_one_substitution_in_fifteen_words():
    got = SAID.replace("Ralston", "Ralphson")
    assert abs(wer(SAID, got) - 1 / 15) < 1e-9


def test_empty_transcript_is_a_failed_transcript_not_a_crash():
    assert wer(SAID, "") == 1.0
    assert wer(SAID, None) == 1.0
    for got in (None, "", "   "):
        result = compare(SAID, got)
        assert not result["ok"] and result["empty"]


def test_my_name_must_survive_even_when_the_rate_passes():
    got = SAID.replace("Raphael", "Rafael")
    result = compare(SAID, got, must_contain=["Ralston", "Raphael", "CPSC 415"])
    assert result["wer"] <= 0.15                      # the rate alone would have passed
    assert result["missing"] == ["Raphael"]
    assert not result["ok"]


def test_small_drift_within_tolerance_is_ok():
    got = "Hi, my name is Ralston Raphael. What did you build for CPSC 415?"   # "this semester" dropped
    result = compare(SAID, got, must_contain=["Ralston", "415"], max_wer=0.15)
    assert result["ok"] and result["wer"] == round(2 / 15, 3)


def test_number_read_as_words_is_a_miss():
    said = "How many laptops did Ralston manage at Ramp: 1,200?"
    got = said.replace("1,200", "twelve hundred")
    assert compare(said, got, must_contain=["1,200"], max_wer=9)["missing"] == ["1,200"]


def test_must_contain_ignores_spacing_and_case():
    got = "what did ralston automate at data grid for cpsc415"
    assert compare("x", got, must_contain=["Datagrid", "CPSC 415"], max_wer=9)["missing"] == []

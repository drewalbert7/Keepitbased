"""Structured console logging."""

from __future__ import annotations

import logging
import sys
from typing import Optional

_LOG: Optional[logging.Logger] = None


def get_logger(name: str = "quant_agi") -> logging.Logger:
    global _LOG
    if _LOG is not None and _LOG.name == name:
        return _LOG

    lg = logging.getLogger(name)
    lg.setLevel(logging.INFO)
    if not lg.handlers:
        h = logging.StreamHandler(sys.stdout)
        h.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
        lg.addHandler(h)
    lg.propagate = False
    _LOG = lg
    return lg

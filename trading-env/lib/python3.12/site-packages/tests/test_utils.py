from krakenapi import utc_unix_time_datetime
from datetime import datetime
import pytest


def test_utc_unix_time_datetime():
    # Test utc unix time in second.
    date_test = utc_unix_time_datetime(1617721936)
    date = datetime(2021, 4, 6, 15, 12, 16)
    assert date_test == date

    # Test non utc (utc+2) time in second.
    date_test = utc_unix_time_datetime(1617714736)
    date = datetime(2021, 4, 6, 15, 12, 16)
    assert date_test != date

    # Test utc unix time in nanosecond.
    date_test = utc_unix_time_datetime(1617728136000000000)
    date = datetime(2021, 4, 6, 16, 55, 36)
    assert date_test == date

    # Raise an error if datetime not in second or nanosecond.
    with pytest.raises(ValueError) as e_info:
        utc_unix_time_datetime(1617728136000000)
    assert "year 51265733 is out of range" in str(e_info.value)


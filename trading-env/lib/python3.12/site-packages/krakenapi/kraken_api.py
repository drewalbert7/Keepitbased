import base64
import binascii
import hashlib
import hmac
import json
import logging
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .utils import utc_unix_time_datetime

logger: logging.Logger = logging.getLogger(__name__)


class KrakenApi:
    """
    Encapsulation of Kraken api through python object.
    Easily requests Kraken's api endpoints.
    """

    api_public_key: str
    api_private_key: str

    def __init__(self, api_public_key: str = "", api_private_key: str = "") -> None:
        """
        Initialize the KrakenAPI object.

        :param api_public_key: Kraken api key.
        :param api_private_key: Kraken api secret key.
        """
        self.api_public_key = api_public_key
        self.api_private_key = api_private_key

    @staticmethod
    def create_api_path(public_method: bool, api_method: str) -> str:
        """
        Given a method, return the api url to request.

        :param public_method: Is the method a public market data.
        :param api_method: Api method as string.
        :return: Api url to request.
        """
        api_domain: str = "https://api.kraken.com"
        api_type = "/0/public/" if public_method else "/0/private/"
        api_path = api_domain + api_type + api_method
        return api_path

    @staticmethod
    def create_api_nonce() -> str:
        """
        Create a unique number identifier as string used for each private REST API endpoints.
        :return: A unique number identifier as string
        """
        api_nonce = str(int(time.time() * 1000))
        return api_nonce

    @staticmethod
    def create_api_post_data(post_inputs: dict = None, api_nonce: str = "") -> bytes:
        """
        Create api post data for private user methods.

        :param api_nonce: Unique API call identifier as string.
        :param post_inputs: POST inputs as dict.
        :return: API post data.
        """
        if post_inputs and api_nonce:
            post_inputs.update({"nonce": api_nonce})
        elif api_nonce:
            post_inputs = {"nonce": api_nonce}
        try:
            api_post_data = urlencode(post_inputs, safe=",").encode()
        except TypeError as e:
            raise TypeError(f"API Post with missing post inputs and nonce.") from e
        return api_post_data

    def create_api_signature(
        self, api_nonce: str, api_post_data: bytes, api_method: str
    ) -> str:
        """
        Create api signature for private user methods.

        :param api_nonce: Unique API call identifier as string.
        :param api_post_data: Bytes encoded API POST data.
        :param api_method: API method to call.
        :return: API signature to use as HTTP header.
        """
        # Cryptographic hash algorithms
        api_sha256 = hashlib.sha256(api_nonce.encode() + api_post_data)
        # Decode API private key from base64 format displayed in account management.
        try:
            api_secret = base64.b64decode(self.api_private_key)
        except binascii.Error as e:
            raise ValueError(f"Incorrect Kraken API private key.") from e
        api_hmac = hmac.new(
            api_secret,
            f"/0/private/{api_method}".encode() + api_sha256.digest(),
            hashlib.sha512,
        )
        # Encode signature into base64 format used in API-Sign value.
        api_signature = base64.b64encode(api_hmac.digest())
        # API authentication signature for use in API-Sign HTTP header.
        api_signature = api_signature.decode()
        return api_signature

    @staticmethod
    def extract_response_data(data: bytes) -> dict:
        """
        Extract data from Kraken API request response.

        :return: Request response data as dict
        """
        data = data.decode()
        try:
            data = json.loads(data)
        except json.decoder.JSONDecodeError as e:
            raise ValueError(
                f"Response received from API was wrongly formatted."
            ) from e
        data = data.get("error")[0] if data.get("error") else data.get("result")
        return data

    def create_api_request(
        self, public_method: bool, api_method: str, post_inputs: dict = None
    ) -> Request:
        """
        Given a method, create a request object to send to Kraken API.

        :param public_method: Is the method a public market data.
        :param api_method: API method as string.
        :param post_inputs: POST inputs as dict.
        :return: Request object.
        """
        api_path = KrakenApi.create_api_path(public_method, api_method)
        if public_method and post_inputs:
            # Create POST data
            api_post_data = self.create_api_post_data(post_inputs)
            request = Request(api_path, data=api_post_data)
        elif public_method:
            request = Request(api_path)
        else:  # Handle API authentication for private user methods.
            api_nonce = self.create_api_nonce()
            # Create POST data.
            api_post_data = self.create_api_post_data(post_inputs, api_nonce)
            # Generate the request
            request = Request(api_path, data=api_post_data)
            # Adding HTTP headers to request.
            api_signature = self.create_api_signature(
                api_nonce, api_post_data, api_method
            )
            request.add_header("API-Sign", api_signature)
            request.add_header("API-Key", self.api_public_key)
        return request

    def send_api_request(self, request: Request) -> dict:
        """
        Given a method, request the Kraken api and return the response data.

        :param request: Request object to send to Kraken API
        :return: Kraken API's response as dict.
        """
        # Request the api.
        try:
            data = urlopen(request).read()
        except (ConnectionResetError, URLError):
            # Handle connection reset error by waiting 0.5s before retrying.
            logger.error("Kraken API connection error. Waiting 0.5s...")
            time.sleep(0.5)
            # Resend request
            return self.send_api_request(request)
        # Decode the API response.
        try:
            data = self.extract_response_data(data)
        except ValueError as e:
            logger.error(f"Kraken API error -> {e}\nRetrying request in 0.5s...")
            time.sleep(0.5)
            # Resend request
            return self.send_api_request(request)
        # Raise an error if Kraken extracted response is a string.
        if type(data) == str:
            if data == "EAPI:Rate limit exceeded":
                # Handle rate limit from Kraken API by waiting 10s.
                logger.error("Kraken API rate limit exceeded. Waiting 10s...")
                time.sleep(10)
                # Resend request
                return self.send_api_request(request)
            else:
                raise ValueError(f"Kraken API error -> {data}")
        return data

    def get_assets(self) -> dict:
        """
        Get information about the assets that are available for deposit,
        withdrawal, trading and staking.

        :return: Dict of available asset pairs and their information.
        """
        request = self.create_api_request(True, "Assets")
        data = self.send_api_request(request)
        return data

    def get_asset_pairs(self) -> dict:
        """
        Get tradable asset pairs

        :return: Dict of available asset pairs and their information.
        """
        request = self.create_api_request(True, "AssetPairs")
        data = self.send_api_request(request)
        return data

    def get_time(self) -> int:
        """
        Return current Kraken time as string.

        :return: Kraken time as string.
        """

        request = self.create_api_request(True, "Time")
        data = self.send_api_request(request)
        kraken_time = data.get("unixtime")
        return kraken_time

    def get_pair_ticker(self, pair: str) -> dict:
        """
        Return pair ticker information.

        :param pair: Pair to get ticker information.
        :return: Pair ticker information as dict.
        """
        post_inputs = {"pair": pair}
        request = self.create_api_request(True, "Ticker", post_inputs)
        data = self.send_api_request(request)
        return data

    def get_balance(self) -> dict:
        """
        Return current Kraken account balance.

        :return: Dict of asset names and balance amount.
        """
        request = self.create_api_request(False, "Balance")
        data = self.send_api_request(request)
        return data

    def get_trade_balance(self) -> dict:
        """
        Return current Kraken account trade balance.

        :return: Dict of asset names and balance amount.
        """
        request = self.create_api_request(False, "TradeBalance")
        data = self.send_api_request(request)
        return data

    def get_open_orders(self) -> dict:
        """
        Return current Kraken open orders.

        :return: Dict of open orders txid as the key.
        """
        request = self.create_api_request(False, "OpenOrders")
        data = self.send_api_request(request)
        data = data.get("open")
        return data

    def get_closed_orders(self, post_inputs: dict = None) -> dict:
        """
        Return current Kraken closed orders.

        :param post_inputs: POST inputs as dict.
        :return: Dict of closed orders with txid as the key.
        """
        request = self.create_api_request(False, "ClosedOrders", post_inputs)
        data = self.send_api_request(request)
        data = data.get("closed")
        return data

    def create_order(
        self,
        pair: str,
        type: str,
        order_type: str,
        price: float,
        volume: float,
        o_flags: str,
    ) -> dict:
        """
        Create an order on kraken with passed arguments.
        More information on Kraken documentation (Add standard order):
        https://www.kraken.com/en-us/features/api

        :param pair: Order pair.
        :param type: Buy or sell order.
        :param order_type: Order type.
        :param price: Price to buy the pair.
        :param volume: Order volume.
        :param o_flags: Order additional flags.
        :return: Pair ticker information as dict.
        """
        post_inputs = {
            "pair": pair,
            "type": type,
            "ordertype": order_type,
            "price": price,
            "volume": volume,
            "oflags": o_flags,
        }
        request = self.create_api_request(False, "AddOrder", post_inputs)
        data = self.send_api_request(request)
        return data

    def get_trades_history(
        self, pair: str, start_unix_time: int, end_unix_time: int
    ) -> list:
        """
        Return trade history for specified pair from Kraken API as nested list.
        More information on Kraken documentation (Get trades history):
        https://www.kraken.com/en-us/features/api

        :param pair: Order pair.
        :param start_unix_time: Start date as unix time in seconds or nanoseconds.
        :param end_unix_time: End date as unix time in seconds or nanoseconds.
        :return: Trade history as list of list.
        """
        download_end_date = utc_unix_time_datetime(end_unix_time)
        trades = list()
        while True:
            post_inputs = {"pair": pair, "since": str(start_unix_time)}
            request = self.create_api_request(True, "Trades", post_inputs)
            data = self.send_api_request(request)
            # Get trades, stored as first key values in returned dict from API
            trades.extend(list(data.values())[0])

            trades_start_date = utc_unix_time_datetime(start_unix_time)
            # Get last trade unix timestamp and update since api parameter
            start_unix_time = int(data.get("last")) + 1
            trades_end_date = utc_unix_time_datetime(start_unix_time)

            logger.info(
                f"{pair}: Downloaded trades from {trades_start_date} to {trades_end_date}."
            )

            # Quit when all trades are downloaded
            if (
                trades_end_date >= download_end_date
                or trades_start_date == trades_end_date
            ):
                break

            # Wait to handle Kraken API rate limit
            time.sleep(1.76)
        return trades

    def get_asset_altname(self, asset: str) -> str:
        """
        From passed asset name, get its alt name on Kraken API.

        :param asset: Asset as string.
        :return: Asset alt name as string.
        """
        available_assets = self.get_assets()
        try:
            altname = [
                asset_infos.get("altname")
                for asset_id, asset_infos in available_assets.items()
                if asset_id == asset or asset_infos.get("altname") == asset
            ][0]
        except IndexError:
            raise ValueError(
                f"{asset} asset not available on Kraken. Available assets:"
                f" {available_assets.keys()}."
            )
        return altname

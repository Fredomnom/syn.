from syn import totp


def test_rfc6238_vektor():
    # Testvektor aus RFC 6238 (SHA1, Schlüssel „12345678901234567890“), auf 6 Stellen gekürzt
    import base64
    secret = base64.b32encode(b"12345678901234567890").decode()
    assert totp.now_code(secret, at=59) == "287082"
    assert totp.now_code(secret, at=1111111109) == "081804"


def test_verify_und_codes():
    s = totp.new_secret()
    assert totp.verify(s, totp.now_code(s)) is not None
    assert totp.verify(s, "000000") is None or totp.now_code(s) == "000000"
    codes = totp.recovery_codes()
    assert len(set(codes)) == 10 and totp.hash_code(codes[0].upper()) == totp.hash_code(codes[0])

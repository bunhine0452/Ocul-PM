//! OS-native secret storage (Keychain / Credential Manager / Secret Service)
//! for API keys and other sensitive values.

use keyring::Entry;

const SERVICE: &str = "com.kimhyunbin.ocul-pm";

fn entry(name: &str) -> Result<Entry, keyring::Error> {
    Entry::new(SERVICE, name)
}

pub fn set(name: &str, value: &str) -> Result<(), keyring::Error> {
    entry(name)?.set_password(value)
}

pub fn get(name: &str) -> Result<Option<String>, keyring::Error> {
    match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn has(name: &str) -> Result<bool, keyring::Error> {
    Ok(get(name)?.is_some())
}

pub fn delete(name: &str) -> Result<(), keyring::Error> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    }
}

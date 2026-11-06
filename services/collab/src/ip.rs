//! The caller's address, read exactly as the app reads it (contracts/client-ip/cases.json):
//! counted from the right of X-Forwarded-For, trusting `trusted_proxy_hops` proxies. With no
//! trusted proxy the socket address is used. IPv4-mapped IPv6 becomes IPv4.
use std::net::IpAddr;

pub fn normalize(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
        v4 => v4,
    }
}

/// None when no trustworthy address can be read (the caller is then refused).
pub fn client_ip(forwarded_for: Option<&str>, socket: Option<IpAddr>, trusted_proxy_hops: usize) -> Option<IpAddr> {
    if trusted_proxy_hops == 0 {
        return socket.map(normalize);
    }
    let entries: Vec<&str> = forwarded_for
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .collect();
    let index = entries.len().checked_sub(trusted_proxy_hops)?;
    entries.get(index)?.parse::<IpAddr>().ok().map(normalize)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> Option<IpAddr> {
        s.parse().ok()
    }

    #[test]
    fn uses_the_socket_without_proxies() {
        assert_eq!(client_ip(Some("6.6.6.6"), ip("10.0.0.5"), 0), ip("10.0.0.5"));
    }

    #[test]
    fn takes_the_entry_the_trusted_proxy_added() {
        assert_eq!(
            client_ip(Some("6.6.6.6, 203.0.113.7"), ip("172.18.0.2"), 1),
            ip("203.0.113.7")
        );
        assert_eq!(client_ip(Some("203.0.113.7"), ip("172.18.0.2"), 1), ip("203.0.113.7"));
    }

    #[test]
    fn refuses_missing_or_malformed_headers_behind_a_proxy() {
        assert_eq!(client_ip(None, ip("172.18.0.2"), 1), None);
        assert_eq!(client_ip(Some("not-an-ip"), ip("172.18.0.2"), 1), None);
        assert_eq!(client_ip(Some("1.2.3.4"), ip("172.18.0.2"), 2), None);
    }

    #[test]
    fn normalizes_ipv4_mapped_ipv6() {
        assert_eq!(client_ip(Some("::ffff:203.0.113.7"), None, 1), ip("203.0.113.7"));
        assert_eq!(client_ip(Some("2001:db8::1"), None, 1), ip("2001:db8::1"));
    }
}

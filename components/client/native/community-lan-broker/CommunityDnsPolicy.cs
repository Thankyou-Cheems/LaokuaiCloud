// SPDX-License-Identifier: AGPL-3.0-or-later
// One application-owned community suffix only. No shell, hosts file or adapter DNS changes.
using System;
using System.Collections.Generic;
using System.IO;
using System.Management;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

sealed class CommunityDnsPolicyRequest {
    public int schemaVersion { get; set; }
    public string operation { get; set; }
    public string zone { get; set; }
    public string ownershipId { get; set; }
}
sealed class CommunityDnsPolicyResponse {
    public int schemaVersion { get; set; }
    public bool ok { get; set; }
    public string code { get; set; }
}
sealed class CommunityDnsPolicyRule {
    public string Name, DisplayName, Comment, NameEncoding, DnsSecEncryption, DirectAccessEncryption, DirectAccessProxyType, DirectAccessProxyName, IPsecCARestriction;
    public string[] Namespaces, NameServers, DirectAccessDnsServers;
    public bool DnsSecEnabled, DnsSecValidationRequired, DnsSecIPsecRequired, DirectAccessEnabled, DirectAccessIPsecRequired;
}
interface ICommunityDnsPolicyBackend {
    List<CommunityDnsPolicyRule> Read();
    void Add(CommunityDnsPolicyRequest request);
    void Remove(CommunityDnsPolicyRequest request, CommunityDnsPolicyRule rule);
}

static class CommunityDnsPolicy {
    internal const string Resolver = "127.0.0.153";
    const string Prefix = "LaokuaiCloud.Dns.v1.";
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8192, RecursionLimit = 4 };
    internal static void Require(bool condition) { if (!condition) throw new InvalidDataException("dns-policy-invalid"); }
    internal static string Display(CommunityDnsPolicyRequest request) { return Prefix + request.ownershipId; }
    internal static string Comment(CommunityDnsPolicyRequest request) { return "LaokuaiCloud managed DNS v1; owner=" + request.ownershipId + "; zone=" + request.zone + "; resolver=" + Resolver; }
    internal static string Namespace(CommunityDnsPolicyRequest request) { return "." + request.zone.TrimEnd('.'); }
    internal static void Validate(CommunityDnsPolicyRequest request) {
        Require(request != null && request.schemaVersion == 1 && (request.operation == "ensure" || request.operation == "remove"));
        Require(request.ownershipId != null && Regex.IsMatch(request.ownershipId, @"\A[0-9a-f]{32}\z"));
        Require(request.zone != null && Regex.IsMatch(request.zone, @"\Ac-[0-9a-f]{32}\.lan\.voice\.ruikang\.wang\.\z"));
    }
    static CommunityDnsPolicyResponse Result(bool ok, string code) { return new CommunityDnsPolicyResponse { schemaVersion = 1, ok = ok, code = code }; }
    static bool Empty(string[] values) { return values == null || values.Length == 0; }
    static bool Option(string value, string expected) { return String.IsNullOrEmpty(value) || String.Equals(value, expected, StringComparison.OrdinalIgnoreCase); }
    static bool SameNamespace(string value, string expected) {
        return value != null && String.Equals(value.TrimEnd('.'), expected, StringComparison.OrdinalIgnoreCase);
    }
    internal static bool Owned(CommunityDnsPolicyRule rule, CommunityDnsPolicyRequest request) {
        Guid identifier;
        return rule != null && Guid.TryParse(rule.Name, out identifier)
            && rule.DisplayName == Display(request) && rule.Comment == Comment(request)
            && rule.Namespaces != null && rule.Namespaces.Length == 1 && SameNamespace(rule.Namespaces[0], Namespace(request))
            && rule.NameServers != null && rule.NameServers.Length == 1 && rule.NameServers[0] == Resolver
            && !rule.DnsSecEnabled && !rule.DnsSecValidationRequired && !rule.DnsSecIPsecRequired
            && !rule.DirectAccessEnabled && !rule.DirectAccessIPsecRequired && Empty(rule.DirectAccessDnsServers)
            && String.IsNullOrEmpty(rule.DirectAccessProxyName) && String.IsNullOrEmpty(rule.IPsecCARestriction)
            && Option(rule.DnsSecEncryption, "None") && Option(rule.DirectAccessEncryption, "None")
            && Option(rule.DirectAccessProxyType, "NoProxy") && Option(rule.NameEncoding, "Disable");
    }
    static bool Marked(CommunityDnsPolicyRule rule, CommunityDnsPolicyRequest request) {
        return rule != null && (rule.DisplayName == Display(request) || rule.Comment == Comment(request));
    }
    static bool Related(string value, string zone) {
        if (String.IsNullOrEmpty(value)) return true; // Unreadable namespace cannot establish that it is unrelated.
        var candidate = value.ToLowerInvariant().TrimEnd('.');
        if (candidate == "") return true; // The global '.' rule.
        if (candidate.StartsWith(".", StringComparison.Ordinal)) candidate = candidate.Substring(1);
        // Prefix/wildcard rules can intercept names in this suffix. Preserve them
        // and refuse preparation when overlap cannot be ruled out.
        if (!Regex.IsMatch(candidate, @"\A[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\z")) return true;
        var suffix = zone.TrimEnd('.');
        return candidate == suffix || candidate.EndsWith("." + suffix, StringComparison.Ordinal)
            || suffix.EndsWith("." + candidate, StringComparison.Ordinal);
    }
    static List<CommunityDnsPolicyRule> MarkedRules(List<CommunityDnsPolicyRule> rules, CommunityDnsPolicyRequest request) {
        Require(rules != null);
        return rules.FindAll(rule => Marked(rule, request));
    }
    static bool Conflict(List<CommunityDnsPolicyRule> rules, CommunityDnsPolicyRequest request) {
        foreach (var rule in rules) {
            if (Owned(rule, request)) continue;
            if (rule == null || rule.Namespaces == null || rule.Namespaces.Length == 0) return true;
            foreach (var value in rule.Namespaces) if (Related(value, request.zone)) return true;
        }
        return false;
    }
    static CommunityDnsPolicyResponse Inspect(List<CommunityDnsPolicyRule> rules, CommunityDnsPolicyRequest request) {
        var marked = MarkedRules(rules, request);
        if (marked.Count > 1 || (marked.Count == 1 && !Owned(marked[0], request))) return Result(false, "ownership-mismatch");
        if (Conflict(rules, request)) return Result(false, "namespace-conflict");
        return marked.Count == 1 ? Result(true, "prepared") : null;
    }
    internal static CommunityDnsPolicyResponse Apply(ICommunityDnsPolicyBackend backend, CommunityDnsPolicyRequest request) {
        Validate(request);
        List<CommunityDnsPolicyRule> rules;
        try { rules = backend.Read(); Require(rules != null); } catch { return Result(false, "wmi-read-failed"); }
        if (request.operation == "ensure") {
            var existing = Inspect(rules, request);
            if (existing != null) return existing;
            // Re-read immediately before Add. The command mutex serializes our
            // processes; a recovered intent therefore discovers the original mark.
            try {
                existing = Inspect(backend.Read(), request);
                if (existing != null) return existing;
                backend.Add(request);
                return Inspect(backend.Read(), request) ?? Result(false, "verification-failed");
            } catch { return Result(false, "wmi-add-failed"); }
        }
        var marked = MarkedRules(rules, request);
        if (marked.Count == 0) return Result(true, "absent");
        if (marked.Count != 1 || !Owned(marked[0], request)) return Result(false, "ownership-mismatch");
        try {
            // Cleanup does not touch foreign conflicts. It removes only the
            // one unchanged owned rule after another full ownership comparison.
            var current = MarkedRules(backend.Read(), request);
            if (current.Count == 0) return Result(true, "absent");
            if (current.Count != 1 || current[0].Name != marked[0].Name || !Owned(current[0], request)) return Result(false, "ownership-mismatch");
            backend.Remove(request, current[0]);
            return MarkedRules(backend.Read(), request).Count == 0 ? Result(true, "removed") : Result(false, "verification-failed");
        } catch { return Result(false, "wmi-remove-failed"); }
    }
    static CommunityDnsPolicyRequest Parse(string line) {
        Require(line != null && line.Length > 0 && System.Text.Encoding.UTF8.GetByteCount(line) <= 8192);
        var fields = Json.DeserializeObject(line) as Dictionary<string, object>;
        Require(fields != null && fields.Count == 4 && fields.ContainsKey("schemaVersion") && fields.ContainsKey("operation") && fields.ContainsKey("zone") && fields.ContainsKey("ownershipId"));
        Require(fields["schemaVersion"] is int && (int)fields["schemaVersion"] == 1 && fields["operation"] is string && fields["zone"] is string && fields["ownershipId"] is string);
        var request = Json.Deserialize<CommunityDnsPolicyRequest>(line);
        Validate(request); return request;
    }
    internal static int Command(TextReader input, TextWriter output) {
        CommunityDnsPolicyResponse response;
        try {
            var text = new System.Text.StringBuilder();
            for (int next; (next = input.Read()) != -1 && next != '\n';) {
                Require(text.Length < 8192); text.Append((char)next);
            }
            var request = Parse(text.ToString().TrimEnd('\r'));
            using (var mutex = new Mutex(false, @"Global\LaokuaiCloud.CommunityDnsPolicy.v1")) {
                bool acquired;
                try { acquired = mutex.WaitOne(500); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) response = Result(false, "policy-busy");
                else {
                    try { response = Apply(new WmiCommunityDnsPolicyBackend(), request); }
                    finally { mutex.ReleaseMutex(); }
                }
            }
        } catch (InvalidDataException) { response = Result(false, "invalid-request"); }
        catch (ArgumentException) { response = Result(false, "invalid-request"); }
        catch { response = Result(false, "policy-unavailable"); }
        output.WriteLine(Json.Serialize(response)); output.Flush(); return response.ok ? 0 : 1;
    }

    // Pure fixture: no ManagementClass, registry, mutex, host rules or elevation.
    sealed class FakeBackend : ICommunityDnsPolicyBackend {
        public List<CommunityDnsPolicyRule> Rules = new List<CommunityDnsPolicyRule>();
        public int Adds, Removes, Reads;
        public bool FailRead, FailAdd, FailRemove;
        public Action<FakeBackend> OnRead;
        public List<CommunityDnsPolicyRule> Read() { Reads++; if (FailRead) throw new Exception(); if (OnRead != null) OnRead(this); return new List<CommunityDnsPolicyRule>(Rules); }
        public void Add(CommunityDnsPolicyRequest request) { if (FailAdd) throw new Exception(); Adds++; Rules.Add(Fresh(request)); }
        public void Remove(CommunityDnsPolicyRequest request, CommunityDnsPolicyRule rule) { if (FailRemove) throw new Exception(); Removes++; Rules.Remove(rule); }
    }
    static CommunityDnsPolicyRule Fresh(CommunityDnsPolicyRequest request) {
        return new CommunityDnsPolicyRule { Name = Guid.NewGuid().ToString("B"), DisplayName = Display(request), Comment = Comment(request), Namespaces = new[]{Namespace(request)}, NameServers = new[]{Resolver}, NameEncoding = "Disable", DirectAccessProxyType = "NoProxy", DirectAccessEncryption = "None", DnsSecEncryption = "None" };
    }
    internal static void SelfTest() {
        var request = new CommunityDnsPolicyRequest { schemaVersion = 1, operation = "ensure", zone = "c-" + new String('a',32) + ".lan.voice.ruikang.wang.", ownershipId = new String('b',32) };
        var fake = new FakeBackend();
        Require(Apply(fake, request).code == "prepared" && fake.Adds == 1);
        Require(Apply(fake, request).code == "prepared" && fake.Adds == 1);
        request.operation = "remove";
        Require(Apply(fake, request).code == "removed" && fake.Removes == 1);
        Require(Apply(fake, request).code == "absent" && fake.Removes == 1);
        request.operation = "ensure";
        var collisions = new Action<CommunityDnsPolicyRule>[] {
            rule => rule.DisplayName = "foreign", rule => rule.Comment = "foreign", rule => rule.NameServers = new[]{"8.8.8.8"},
            rule => rule.Namespaces = new[]{".voice.ruikang.wang"}, rule => rule.Namespaces = new[]{Namespace(request), ".other.example"},
            rule => rule.NameServers = new[]{Resolver,"8.8.8.8"}, rule => rule.DnsSecEnabled = true, rule => rule.DnsSecValidationRequired = true,
            rule => rule.DnsSecIPsecRequired = true, rule => rule.DirectAccessEnabled = true, rule => rule.DirectAccessIPsecRequired = true,
            rule => rule.DirectAccessDnsServers = new[]{"8.8.8.8"}, rule => rule.DirectAccessProxyName = "foreign", rule => rule.IPsecCARestriction = "foreign",
            rule => rule.DnsSecEncryption = "High", rule => rule.DirectAccessEncryption = "High", rule => rule.DirectAccessProxyType = "UseDefault", rule => rule.NameEncoding = "Utf8WithMapping",
            rule => rule.Name = "untrusted-name"
        };
        foreach (var edit in collisions) {
            var altered = new FakeBackend(); var rule = Fresh(request); edit(rule); altered.Rules.Add(rule);
            Require(!Apply(altered, request).ok && altered.Adds == 0);
            request.operation = "remove";
            Require(!Apply(altered, request).ok && altered.Removes == 0 && altered.Rules.Count == 1);
            request.operation = "ensure";
        }
        foreach (var name in new[]{Namespace(request), ".voice.ruikang.wang", ".sub." + request.zone.TrimEnd('.'), "member." + request.zone.TrimEnd('.'), ".", "prefix*"}) {
            var foreign = new FakeBackend(); foreign.Rules.Add(new CommunityDnsPolicyRule { Namespaces = new[]{name} });
            Require(Apply(foreign, request).code == "namespace-conflict" && foreign.Adds == 0);
            request.operation = "remove";
            Require(Apply(foreign, request).code == "absent" && foreign.Removes == 0);
            request.operation = "ensure";
        }
        var duplicate = new FakeBackend(); duplicate.Rules.Add(Fresh(request)); duplicate.Rules.Add(Fresh(request));
        Require(Apply(duplicate, request).code == "ownership-mismatch" && duplicate.Adds == 0);
        request.operation = "remove"; Require(!Apply(duplicate, request).ok && duplicate.Removes == 0); request.operation = "ensure";
        var raced = new FakeBackend(); raced.OnRead = state => { if (state.Reads == 2) state.Rules.Add(Fresh(request)); };
        Require(Apply(raced, request).code == "prepared" && raced.Adds == 0);
        var failure = new FakeBackend { FailRead = true }; Require(Apply(failure, request).code == "wmi-read-failed");
        failure = new FakeBackend { FailAdd = true }; Require(Apply(failure, request).code == "wmi-add-failed");
        failure = new FakeBackend { FailRemove = true }; failure.Rules.Add(Fresh(request)); request.operation = "remove";
        Require(Apply(failure, request).code == "wmi-remove-failed" && failure.Rules.Count == 1);
        request.operation = "ensure";
        var unrelated = new FakeBackend(); unrelated.Rules.Add(new CommunityDnsPolicyRule { Namespaces = new[]{".other.example"} });
        Require(Apply(unrelated, request).ok && unrelated.Adds == 1 && unrelated.Rules.Count == 2);
        unrelated.Rules.Add(new CommunityDnsPolicyRule { Namespaces = new[]{".voice.ruikang.wang"} });
        Require(Apply(unrelated, request).code == "namespace-conflict" && unrelated.Adds == 1);
        request.operation = "remove";
        Require(Apply(unrelated, request).code == "removed" && unrelated.Removes == 1 && unrelated.Rules.Count == 2);
        request.operation = "ensure";
        var changed = new FakeBackend(); changed.Rules.Add(Fresh(request));
        changed.OnRead = state => { if (state.Reads == 2) state.Rules[0].NameServers = new[]{"8.8.8.8"}; };
        request.operation = "remove";
        Require(Apply(changed, request).code == "ownership-mismatch" && changed.Removes == 0);
        request.operation = "ensure";
        Parse(Json.Serialize(request));
        foreach (var invalid in new[]{Json.Serialize(request).Replace("ensure", "arbitrary"), Json.Serialize(request).Replace(request.zone, "voice.ruikang.wang."), Json.Serialize(request).Replace(request.ownershipId, "bad"), Json.Serialize(request).Replace("\"schemaVersion\":1", "\"schemaVersion\":2"), Json.Serialize(request).TrimEnd('}') + ",\"NameServers\":[\"8.8.8.8\"]}"}) {
            bool rejected = false; try { Parse(invalid); } catch { rejected = true; } Require(rejected);
        }
        var output = new StringWriter(); Require(Command(new StringReader(new String('x',8193)), output) == 1 && output.ToString().Contains("invalid-request"));
        Console.WriteLine("PASS DNS policy CLR fixture: idempotence, 19 property collisions, 6 foreign overlaps, duplicates, recovery/race, WMI failures, strict wire; no OS DNS access");
    }
}

sealed class WmiCommunityDnsPolicyBackend : ICommunityDnsPolicyBackend {
    // Official Windows DNS Client provider. All method parameters are fixed or
    // derived from the validated application zone. GPO/remote Server stay null.
    // https://learn.microsoft.com/en-us/previous-versions/windows/desktop/dnsclientpsprov/ps-dnsclientnrptrule
    static ManagementClass Provider() {
        return new ManagementClass(new ManagementScope(@"\\.\root\Microsoft\Windows\DNS"), new ManagementPath("PS_DnsClientNrptRule"), null);
    }
    static string Text(ManagementBaseObject rule, string name) { return Convert.ToString(rule[name]); }
    static bool Flag(ManagementBaseObject rule, string name) { CommunityDnsPolicy.Require(rule[name] is bool); return (bool)rule[name]; }
    static string[] Strings(ManagementBaseObject rule, string name) {
        if (rule[name] == null) return new string[0];
        var array = rule[name] as string[]; CommunityDnsPolicy.Require(array != null); return array;
    }
    static CommunityDnsPolicyRule ConvertRule(ManagementBaseObject rule) {
        return new CommunityDnsPolicyRule { Name = Text(rule,"Name"), DisplayName = Text(rule,"DisplayName"), Comment = Text(rule,"Comment"),
            Namespaces = Strings(rule,"Namespace"), NameServers = Strings(rule,"NameServers"), NameEncoding = Text(rule,"NameEncoding"),
            DnsSecEnabled = Flag(rule,"DnsSecEnabled"), DnsSecValidationRequired = Flag(rule,"DnsSecValidationRequired"), DnsSecIPsecRequired = Flag(rule,"DnsSecQueryIPsecRequired"), DnsSecEncryption = Text(rule,"DnsSecQueryIPsecEncryption"),
            DirectAccessEnabled = Flag(rule,"DirectAccessEnabled"), DirectAccessIPsecRequired = Flag(rule,"DirectAccessQueryIPsecRequired"), DirectAccessEncryption = Text(rule,"DirectAccessQueryIPsecEncryption"),
            DirectAccessDnsServers = Strings(rule,"DirectAccessDnsServers"), DirectAccessProxyType = Text(rule,"DirectAccessProxyType"), DirectAccessProxyName = Text(rule,"DirectAccessProxyName"), IPsecCARestriction = Text(rule,"IPsecCARestriction") };
    }
    public List<CommunityDnsPolicyRule> Read() { return Read(null); }
    static List<CommunityDnsPolicyRule> Read(string name) {
        using (var provider = Provider()) using (var input = provider.GetMethodParameters("Get")) {
            if (name != null) input["Name"] = new[]{name};
            using (var result = provider.InvokeMethod("Get", input, null)) {
                CommunityDnsPolicy.Require(result != null && Convert.ToUInt32(result["ReturnValue"]) == 0);
                var rules = new List<CommunityDnsPolicyRule>();
                var values = result["cmdletOutput"] as Array;
                if (result["cmdletOutput"] != null) CommunityDnsPolicy.Require(values != null);
                if (values != null) foreach (var value in values) {
                    var rule = value as ManagementBaseObject; CommunityDnsPolicy.Require(rule != null);
                    rules.Add(ConvertRule(rule));
                }
                return rules;
            }
        }
    }
    public void Add(CommunityDnsPolicyRequest request) {
        CommunityDnsPolicy.Validate(request);
        using (var provider = Provider()) using (var input = provider.GetMethodParameters("Add")) {
            input["Namespace"] = new[]{CommunityDnsPolicy.Namespace(request)};
            input["NameServers"] = new[]{CommunityDnsPolicy.Resolver};
            input["DisplayName"] = CommunityDnsPolicy.Display(request); input["Comment"] = CommunityDnsPolicy.Comment(request);
            input["DAEnable"] = false; input["DAIPsecRequired"] = false; input["DAIPsecEncryptionType"] = "None";
            input["DAProxyType"] = "NoProxy"; input["DAProxyServerName"] = ""; input["DANameServers"] = new string[0];
            input["DnsSecEnable"] = false; input["DnsSecValidationRequired"] = false; input["DnsSecIPsecRequired"] = false;
            input["DnsSecIPsecEncryptionType"] = "None"; input["IPsecTrustAuthority"] = ""; input["NameEncoding"] = "Disable"; input["PassThru"] = false;
            using (var result = provider.InvokeMethod("Add", input, null)) CommunityDnsPolicy.Require(result != null && Convert.ToUInt32(result["ReturnValue"]) == 0);
        }
    }
    public void Remove(CommunityDnsPolicyRequest request, CommunityDnsPolicyRule rule) {
        CommunityDnsPolicy.Validate(request);
        var latest = Read(rule.Name);
        CommunityDnsPolicy.Require(latest.Count == 1 && latest[0].Name == rule.Name && CommunityDnsPolicy.Owned(latest[0],request));
        using (var provider = Provider()) using (var input = provider.GetMethodParameters("Remove")) {
            input["Name"] = rule.Name; input["Force"] = true; input["PassThru"] = false;
            using (var result = provider.InvokeMethod("Remove", input, null)) CommunityDnsPolicy.Require(result != null && Convert.ToUInt32(result["ReturnValue"]) == 0);
        }
    }
}

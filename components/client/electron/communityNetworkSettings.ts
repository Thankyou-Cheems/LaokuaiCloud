import { type CommunityNetworkPreferences,DEFAULT_COMMUNITY_NETWORK_PREFERENCES, parseCommunityNetworkPreferences } from '../src/lib/communityNetworkPreferences';

/** Non-secret settings only. Running sessions hold one immutable startup snapshot. */
export class CommunityNetworkSettings {
  private session: CommunityNetworkPreferences | null = null;
  constructor(private read: () => unknown, private write: (value: CommunityNetworkPreferences) => void) {}
  get(): CommunityNetworkPreferences {
    try { return parseCommunityNetworkPreferences(this.read()); }
    catch { return {...DEFAULT_COMMUNITY_NETWORK_PREFERENCES}; }
  }
  forSession(): CommunityNetworkPreferences {
    this.session ??= this.get();
    return {...this.session};
  }
  set(value: unknown): {preferences: CommunityNetworkPreferences; reconnectRequired: true} {
    const preferences = parseCommunityNetworkPreferences(value);
    this.forSession(); // A settings write never partially mutates a live network.
    this.write(preferences);
    return {preferences: {...preferences}, reconnectRequired: true};
  }
}

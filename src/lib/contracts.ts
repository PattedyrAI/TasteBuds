/** Public browser/server contracts. Never add provider credentials to these types. */
export interface User { id: string; discordId: string | null; nickname: string | null; aiEnabled: boolean; displayName: string; avatarUrl: string | null }
/** memberCount counts current members with at least one nondeleted rating; members remains the full management roster. */
export interface Group { mapsEnabled?: boolean; id: string; name: string; ownerId: string; role: 'owner' | 'admin' | 'member'; memberCount: number; createdAt: string }
export interface Member extends User { role: 'owner' | 'admin' | 'member'; joinedAt: string }
export interface Person { id: string; displayName: string; avatarUrl: string | null; role: 'owner' | 'admin' | 'member'; joinedAt: string; ratingCount: number; itemCount: number; lastRatedAt: string | null }
export interface PersonRating { photoIds?: string[]; isRereview?: boolean; countsTowardAverage?: boolean; id: string; itemId: string; itemName: string; brand: string | null; variant: string | null; score: number; note: string | null; photoId: string | null; tastedAt: string; legacyPhotoMissing: boolean }
export interface PersonRatingsPage { person: Person; ratings: PersonRating[]; nextCursor: string | null }
export interface CategoryField { id: string; label: string; type: 'text'|'number'|'price'|'select'|'boolean'|'location'; required: boolean; filterable: boolean; options?: string[] }
export type CustomFields = Record<string,string|number|boolean>;
export interface Category { id: string; name: string; fields: CategoryField[] }
export interface GroupDetail extends Group { categories?: Category[]; inviteCode: string | null; members: Member[]; discordConnected: boolean; stats: { itemCount: number; tastingCount: number; activeMembers: number } }
export interface Bootstrap { user: User; groups: Group[] }
export interface Item { customFields?: CustomFields; categoryFields?: CategoryField[]; placeId?: string | null;  myScore?: number | null; saved?: boolean; reviewers?: Pick<User, 'id' | 'displayName' | 'avatarUrl'>[]; id: string; groupId: string; createdBy: string; name: string; brand: string | null; variant: string | null; type: string | null; broadCategory: string | null; photoId: string | null; average: number | null; raterCount: number; tastingCount: number; lastRatedAt: string | null }
export interface Comment { id: string; ratingId: string; author: User; body: string; createdAt: string }
export interface Rating { photoIds?: string[]; customFields?: CustomFields; categoryFields?: CategoryField[]; isRereview?: boolean; countsTowardAverage?: boolean; id: string; groupId: string; itemId: string; author: User; score: number; note: string | null; tastedAt: string; createdAt: string; updatedAt: string; photoId: string | null; legacyPhotoMissing: boolean; comments: Comment[] }
export interface FeedEntry extends Rating { itemName: string; brand: string | null; variant: string | null }
export interface ItemDetail extends Item { ratings: Rating[] }
export interface CreateRatingInput { photoIds?: string[]; customFields?: CustomFields; groupId: string; itemId?: string; rereviewOf?: string; name?: string; brand?: string | null; variant?: string | null; type?: string | null; broadCategory?: string | null; score: number; note?: string | null; tastedAt?: string; photoId: string; idempotencyKey?: string }
export interface UpdateRatingInput { photoIds?: string[]; customFields?: CustomFields; score?: number; note?: string | null; tastedAt?: string; photoId?: string }
export interface ItemFilters { search?: string; brand?: string; type?: string; sort?: 'recent' | 'score' | 'name' | 'most-rated'; limit?: number; offset?: number }
export interface GroupPatch { name?: string; ownerId?: string; leave?: boolean }
export interface RecognitionSuggestion { name: string; brand: string | null; variant: string | null; type: string | null; broadCategory: string | null; confidence: number }
export interface RecognitionResult { status: 'completed' | 'failed'; suggestion: RecognitionSuggestion | null; matches: Item[]; message?: string }
export interface UploadedPhoto { id: string; mimeType: string; width: number; height: number }
export interface UpdateItemInput { name?: string; brand?: string | null; variant?: string | null; type?: string | null; broadCategory?: string | null }
export interface UpdateCommentInput { body: string }

export interface UpdatePreferencesInput { aiEnabled: boolean }

export interface RestaurantLocation { lat: number; lng: number }
export interface RestaurantPin { item: Item; placeId: string; location: RestaurantLocation | null }
export interface RestaurantMap { enabled: boolean; configured: boolean; browserKey: string; mapId: string; restaurants: RestaurantPin[]; unavailableCount: number }

export interface TasteMatch {
  person: Pick<User, 'id' | 'displayName' | 'avatarUrl'>;
  sharedCount: number;
  meanDifference: number;
  similarCount: number;
  disagreements: { itemId: string; itemName: string; myScore: number; theirScore: number; difference: number }[];
}
export interface DivisiveItem { itemId: string; itemName: string; brand: string | null; lowScore: number; highScore: number; raterCount: number }
export interface TasteInsights { matches: TasteMatch[]; divisive: DivisiveItem[] }

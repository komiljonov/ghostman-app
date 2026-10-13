export namespace api {
	
	export class TeamRef {
	    id: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new TeamRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class AcceptedInvitation {
	    id: string;
	    status: string;
	    team: TeamRef;
	
	    static createFrom(source: any = {}) {
	        return new AcceptedInvitation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.status = source["status"];
	        this.team = this.convertValues(source["team"], TeamRef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Auth {
	    type: string;
	    bearer_token: string;
	    basic_username: string;
	    basic_password: string;
	    api_key_name: string;
	    api_key_value: string;
	    api_key_in: string;
	
	    static createFrom(source: any = {}) {
	        return new Auth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.bearer_token = source["bearer_token"];
	        this.basic_username = source["basic_username"];
	        this.basic_password = source["basic_password"];
	        this.api_key_name = source["api_key_name"];
	        this.api_key_value = source["api_key_value"];
	        this.api_key_in = source["api_key_in"];
	    }
	}
	export class AuthPatch {
	    type: string;
	    bearer_token?: string;
	    basic_username?: string;
	    basic_password?: string;
	    api_key_name?: string;
	    api_key_value?: string;
	    api_key_in?: string;
	
	    static createFrom(source: any = {}) {
	        return new AuthPatch(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.bearer_token = source["bearer_token"];
	        this.basic_username = source["basic_username"];
	        this.basic_password = source["basic_password"];
	        this.api_key_name = source["api_key_name"];
	        this.api_key_value = source["api_key_value"];
	        this.api_key_in = source["api_key_in"];
	    }
	}
	export class CaptureSummary {
	    id: number;
	    method: string;
	    path: string;
	    query: string;
	    content_type: string;
	    body_size: number;
	    body_truncated: boolean;
	    source_ip: string;
	    received_at: string;
	
	    static createFrom(source: any = {}) {
	        return new CaptureSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.method = source["method"];
	        this.path = source["path"];
	        this.query = source["query"];
	        this.content_type = source["content_type"];
	        this.body_size = source["body_size"];
	        this.body_truncated = source["body_truncated"];
	        this.source_ip = source["source_ip"];
	        this.received_at = source["received_at"];
	    }
	}
	export class CapturedHeader {
	    key: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new CapturedHeader(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	    }
	}
	export class Environment {
	    id: string;
	    name: string;
	    sort_order: number;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new Environment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
	    }
	}
	export class EnvironmentDetail {
	    id: string;
	    project_id: string;
	    name: string;
	    sort_order: number;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new EnvironmentDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.project_id = source["project_id"];
	        this.name = source["name"];
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
	    }
	}
	export class Folder {
	    id: string;
	    parent_id?: string;
	    name: string;
	    follow_redirects: string;
	    auth: Auth;
	    pre_script: string;
	    post_script: string;
	    sort_order: number;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new Folder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.parent_id = source["parent_id"];
	        this.name = source["name"];
	        this.follow_redirects = source["follow_redirects"];
	        this.auth = this.convertValues(source["auth"], Auth);
	        this.pre_script = source["pre_script"];
	        this.post_script = source["post_script"];
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FolderDetail {
	    id: string;
	    project_id: string;
	    parent_id?: string;
	    name: string;
	    follow_redirects: string;
	    auth: Auth;
	    pre_script: string;
	    post_script: string;
	    sort_order: number;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new FolderDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.project_id = source["project_id"];
	        this.parent_id = source["parent_id"];
	        this.name = source["name"];
	        this.follow_redirects = source["follow_redirects"];
	        this.auth = this.convertValues(source["auth"], Auth);
	        this.pre_script = source["pre_script"];
	        this.post_script = source["post_script"];
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Invitation {
	    id: string;
	    team_id: string;
	    email: string;
	    status: string;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new Invitation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.team_id = source["team_id"];
	        this.email = source["email"];
	        this.status = source["status"];
	        this.created_at = source["created_at"];
	    }
	}
	export class Inviter {
	    name: string;
	    email: string;
	
	    static createFrom(source: any = {}) {
	        return new Inviter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.email = source["email"];
	    }
	}
	export class KeyValue {
	    key: string;
	    value: string;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new KeyValue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	        this.enabled = source["enabled"];
	    }
	}
	export class MemberAccess {
	    user_id: string;
	    all_projects: boolean;
	    project_ids: string[];
	
	    static createFrom(source: any = {}) {
	        return new MemberAccess(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.user_id = source["user_id"];
	        this.all_projects = source["all_projects"];
	        this.project_ids = source["project_ids"];
	    }
	}
	export class MemberProjectGrant {
	    id: string;
	    name: string;
	    granted: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MemberProjectGrant(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.granted = source["granted"];
	    }
	}
	export class MemberAccessView {
	    user_id: string;
	    all_projects: boolean;
	    projects: MemberProjectGrant[];
	
	    static createFrom(source: any = {}) {
	        return new MemberAccessView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.user_id = source["user_id"];
	        this.all_projects = source["all_projects"];
	        this.projects = this.convertValues(source["projects"], MemberProjectGrant);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Meta {
	    hooks_domains: string[];
	
	    static createFrom(source: any = {}) {
	        return new Meta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hooks_domains = source["hooks_domains"];
	    }
	}
	export class MyInvitation {
	    id: string;
	    team: TeamRef;
	    invited_by: Inviter;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new MyInvitation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.team = this.convertValues(source["team"], TeamRef);
	        this.invited_by = this.convertValues(source["invited_by"], Inviter);
	        this.created_at = source["created_at"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Project {
	    id: string;
	    team_id: string;
	    name: string;
	    owner_id: string;
	    sort_order: number;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.team_id = source["team_id"];
	        this.name = source["name"];
	        this.owner_id = source["owner_id"];
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
	    }
	}
	export class ProjectAccess {
	    user_ids: string[];
	
	    static createFrom(source: any = {}) {
	        return new ProjectAccess(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.user_ids = source["user_ids"];
	    }
	}
	export class ProjectAccessUser {
	    user_id: string;
	    email: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectAccessUser(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.user_id = source["user_id"];
	        this.email = source["email"];
	        this.name = source["name"];
	    }
	}
	export class ProjectSummary {
	    id: string;
	    name: string;
	    owner_id: string;
	    sort_order: number;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.owner_id = source["owner_id"];
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
	    }
	}
	export class RequestBody {
	    type: string;
	    content_type: string;
	    content: string;
	    fields: KeyValue[];
	
	    static createFrom(source: any = {}) {
	        return new RequestBody(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.content_type = source["content_type"];
	        this.content = source["content"];
	        this.fields = this.convertValues(source["fields"], KeyValue);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Request {
	    id: string;
	    project_id: string;
	    folder_id?: string;
	    name: string;
	    method: string;
	    url: string;
	    follow_redirects: string;
	    response_filter: string;
	    auth: Auth;
	    sort_order: number;
	    created_at: string;
	    updated_at: string;
	    headers: KeyValue[];
	    query_params: KeyValue[];
	    body: RequestBody;
	    pre_script: string;
	    post_script: string;
	
	    static createFrom(source: any = {}) {
	        return new Request(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.project_id = source["project_id"];
	        this.folder_id = source["folder_id"];
	        this.name = source["name"];
	        this.method = source["method"];
	        this.url = source["url"];
	        this.follow_redirects = source["follow_redirects"];
	        this.response_filter = source["response_filter"];
	        this.auth = this.convertValues(source["auth"], Auth);
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.headers = this.convertValues(source["headers"], KeyValue);
	        this.query_params = this.convertValues(source["query_params"], KeyValue);
	        this.body = this.convertValues(source["body"], RequestBody);
	        this.pre_script = source["pre_script"];
	        this.post_script = source["post_script"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class RequestDraft {
	    method: string;
	    url: string;
	    headers: KeyValue[];
	    query_params: KeyValue[];
	    body: RequestBody;
	    auth: Auth;
	    response_filter: string;
	    pre_script: string;
	    post_script: string;
	
	    static createFrom(source: any = {}) {
	        return new RequestDraft(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.method = source["method"];
	        this.url = source["url"];
	        this.headers = this.convertValues(source["headers"], KeyValue);
	        this.query_params = this.convertValues(source["query_params"], KeyValue);
	        this.body = this.convertValues(source["body"], RequestBody);
	        this.auth = this.convertValues(source["auth"], Auth);
	        this.response_filter = source["response_filter"];
	        this.pre_script = source["pre_script"];
	        this.post_script = source["post_script"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RequestPatch {
	    name?: string;
	    method?: string;
	    url?: string;
	    headers?: KeyValue[];
	    query_params?: KeyValue[];
	    body?: RequestBody;
	    follow_redirects?: string;
	    auth?: AuthPatch;
	    response_filter?: string;
	    pre_script?: string;
	    post_script?: string;
	
	    static createFrom(source: any = {}) {
	        return new RequestPatch(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.method = source["method"];
	        this.url = source["url"];
	        this.headers = this.convertValues(source["headers"], KeyValue);
	        this.query_params = this.convertValues(source["query_params"], KeyValue);
	        this.body = this.convertValues(source["body"], RequestBody);
	        this.follow_redirects = source["follow_redirects"];
	        this.auth = this.convertValues(source["auth"], AuthPatch);
	        this.response_filter = source["response_filter"];
	        this.pre_script = source["pre_script"];
	        this.post_script = source["post_script"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RequestSummary {
	    id: string;
	    project_id: string;
	    folder_id?: string;
	    name: string;
	    method: string;
	    url: string;
	    follow_redirects: string;
	    response_filter: string;
	    auth: Auth;
	    sort_order: number;
	    created_at: string;
	    updated_at: string;
	
	    static createFrom(source: any = {}) {
	        return new RequestSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.project_id = source["project_id"];
	        this.folder_id = source["folder_id"];
	        this.name = source["name"];
	        this.method = source["method"];
	        this.url = source["url"];
	        this.follow_redirects = source["follow_redirects"];
	        this.response_filter = source["response_filter"];
	        this.auth = this.convertValues(source["auth"], Auth);
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TeamMember {
	    user_id: string;
	    email: string;
	    name: string;
	    all_projects: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TeamMember(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.user_id = source["user_id"];
	        this.email = source["email"];
	        this.name = source["name"];
	        this.all_projects = source["all_projects"];
	    }
	}
	export class Team {
	    id: string;
	    name: string;
	    created_at: string;
	    is_owner: boolean;
	    members: TeamMember[];
	
	    static createFrom(source: any = {}) {
	        return new Team(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.created_at = source["created_at"];
	        this.is_owner = source["is_owner"];
	        this.members = this.convertValues(source["members"], TeamMember);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TeamInvitation {
	    id: string;
	    email: string;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new TeamInvitation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.email = source["email"];
	        this.created_at = source["created_at"];
	    }
	}
	
	
	export class TeamSummary {
	    id: string;
	    name: string;
	    member_count: number;
	    is_owner: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TeamSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.member_count = source["member_count"];
	        this.is_owner = source["is_owner"];
	    }
	}
	export class User {
	    id: string;
	    email: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new User(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.email = source["email"];
	        this.name = source["name"];
	    }
	}
	export class Variable {
	    id: string;
	    key: string;
	    type: string;
	    value?: string;
	    sort_order: number;
	
	    static createFrom(source: any = {}) {
	        return new Variable(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.key = source["key"];
	        this.type = source["type"];
	        this.value = source["value"];
	        this.sort_order = source["sort_order"];
	    }
	}
	export class Webhook {
	    id: string;
	    name: string;
	    slug: string;
	    domain: string;
	    resp_status: number;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new Webhook(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.slug = source["slug"];
	        this.domain = source["domain"];
	        this.resp_status = source["resp_status"];
	        this.created_at = source["created_at"];
	    }
	}
	export class WebhookDetail {
	    id: string;
	    project_id: string;
	    name: string;
	    slug: string;
	    domain: string;
	    resp_status: number;
	    resp_headers: KeyValue[];
	    resp_body: string;
	    created_by: string;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new WebhookDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.project_id = source["project_id"];
	        this.name = source["name"];
	        this.slug = source["slug"];
	        this.domain = source["domain"];
	        this.resp_status = source["resp_status"];
	        this.resp_headers = this.convertValues(source["resp_headers"], KeyValue);
	        this.resp_body = source["resp_body"];
	        this.created_by = source["created_by"];
	        this.created_at = source["created_at"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace engine {
	
	export class Header {
	    key: string;
	    value: string;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Header(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	        this.enabled = source["enabled"];
	    }
	}
	export class Hop {
	    url: string;
	    method: string;
	    status: number;
	    status_text: string;
	    dns_ms?: number;
	    connect_ms?: number;
	    wait_ms?: number;
	    download_ms?: number;
	    total_ms: number;
	    connection_reused: boolean;
	    remote_addr: string;
	    failed_phase?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new Hop(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.method = source["method"];
	        this.status = source["status"];
	        this.status_text = source["status_text"];
	        this.dns_ms = source["dns_ms"];
	        this.connect_ms = source["connect_ms"];
	        this.wait_ms = source["wait_ms"];
	        this.download_ms = source["download_ms"];
	        this.total_ms = source["total_ms"];
	        this.connection_reused = source["connection_reused"];
	        this.remote_addr = source["remote_addr"];
	        this.failed_phase = source["failed_phase"];
	        this.error = source["error"];
	    }
	}
	export class Response {
	    status: number;
	    statusText: string;
	    proto: string;
	    headers: Header[];
	    durationMs: number;
	    bodySize: number;
	    body: string;
	    truncated: boolean;
	    contentType: string;
	    formatted: boolean;
	    rawBody?: string;
	    media: string;
	    mediaUrl?: string;
	    hops: Hop[];
	
	    static createFrom(source: any = {}) {
	        return new Response(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.statusText = source["statusText"];
	        this.proto = source["proto"];
	        this.headers = this.convertValues(source["headers"], Header);
	        this.durationMs = source["durationMs"];
	        this.bodySize = source["bodySize"];
	        this.body = source["body"];
	        this.truncated = source["truncated"];
	        this.contentType = source["contentType"];
	        this.formatted = source["formatted"];
	        this.rawBody = source["rawBody"];
	        this.media = source["media"];
	        this.mediaUrl = source["mediaUrl"];
	        this.hops = this.convertValues(source["hops"], Hop);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace envs {
	
	export class KeyInfo {
	    key: string;
	    envs: string[];
	    env_ids: string[];
	    secret: boolean;
	
	    static createFrom(source: any = {}) {
	        return new KeyInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.envs = source["envs"];
	        this.env_ids = source["env_ids"];
	        this.secret = source["secret"];
	    }
	}
	export class VariableView {
	    id: string;
	    key: string;
	    type: string;
	    value: string;
	    has_value: boolean;
	    sort_order: number;
	
	    static createFrom(source: any = {}) {
	        return new VariableView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.key = source["key"];
	        this.type = source["type"];
	        this.value = source["value"];
	        this.has_value = source["has_value"];
	        this.sort_order = source["sort_order"];
	    }
	}
	export class EnvContext {
	    environments: api.Environment[];
	    active_id: string;
	    active_name: string;
	    variables: VariableView[];
	    keys: KeyInfo[];
	
	    static createFrom(source: any = {}) {
	        return new EnvContext(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.environments = this.convertValues(source["environments"], api.Environment);
	        this.active_id = source["active_id"];
	        this.active_name = source["active_name"];
	        this.variables = this.convertValues(source["variables"], VariableView);
	        this.keys = this.convertValues(source["keys"], KeyInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

export namespace importer {
	
	export class Entry {
	    severity: string;
	    code: string;
	    path: string;
	    message: string;
	    action?: string;
	    detail?: string;
	    detail_label?: string;
	    kind?: string;
	    location?: string;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.severity = source["severity"];
	        this.code = source["code"];
	        this.path = source["path"];
	        this.message = source["message"];
	        this.action = source["action"];
	        this.detail = source["detail"];
	        this.detail_label = source["detail_label"];
	        this.kind = source["kind"];
	        this.location = source["location"];
	    }
	}
	export class Summary {
	    folders: number;
	    requests: number;
	    environments: number;
	    variables: number;
	
	    static createFrom(source: any = {}) {
	        return new Summary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.folders = source["folders"];
	        this.requests = source["requests"];
	        this.environments = source["environments"];
	        this.variables = source["variables"];
	    }
	}
	export class Report {
	    kind: string;
	    source: string;
	    format: string;
	    name: string;
	    target: string;
	    summary: Summary;
	    notes: string[];
	    imported: Entry[];
	    changed: Entry[];
	    dropped: Entry[];
	    failed: Entry[];
	    stopped: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new Report(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.source = source["source"];
	        this.format = source["format"];
	        this.name = source["name"];
	        this.target = source["target"];
	        this.summary = this.convertValues(source["summary"], Summary);
	        this.notes = source["notes"];
	        this.imported = this.convertValues(source["imported"], Entry);
	        this.changed = this.convertValues(source["changed"], Entry);
	        this.dropped = this.convertValues(source["dropped"], Entry);
	        this.failed = this.convertValues(source["failed"], Entry);
	        this.stopped = source["stopped"];
	        this.text = source["text"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class AcceptedInvitationResult {
	    data?: api.AcceptedInvitation;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new AcceptedInvitationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.AcceptedInvitation);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CaptureDetail {
	    summary: api.CaptureSummary;
	    headers: api.CapturedHeader[];
	    body: string;
	    raw_body: string;
	    formatted: boolean;
	    preview_cut: boolean;
	    stored_bytes: number;
	    media: string;
	
	    static createFrom(source: any = {}) {
	        return new CaptureDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.summary = this.convertValues(source["summary"], api.CaptureSummary);
	        this.headers = this.convertValues(source["headers"], api.CapturedHeader);
	        this.body = source["body"];
	        this.raw_body = source["raw_body"];
	        this.formatted = source["formatted"];
	        this.preview_cut = source["preview_cut"];
	        this.stored_bytes = source["stored_bytes"];
	        this.media = source["media"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CaptureDetailResult {
	    data?: CaptureDetail;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new CaptureDetailResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], CaptureDetail);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CaptureListResult {
	    data: api.CaptureSummary[];
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new CaptureListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.CaptureSummary);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DeletedResult {
	    data: number;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new DeletedResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = source["data"];
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class EmptyResult {
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new EmptyResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class EnvContextResult {
	    data?: envs.EnvContext;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new EnvContextResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], envs.EnvContext);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class EnvironmentResult {
	    data?: api.EnvironmentDetail;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new EnvironmentResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.EnvironmentDetail);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FilterResult {
	    result_json: string;
	    result_is_text: boolean;
	    count: number;
	    truncated: boolean;
	    matched_note: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new FilterResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.result_json = source["result_json"];
	        this.result_is_text = source["result_is_text"];
	        this.count = source["count"];
	        this.truncated = source["truncated"];
	        this.matched_note = source["matched_note"];
	        this.error = source["error"];
	    }
	}
	export class FolderListResult {
	    data: api.Folder[];
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new FolderListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.Folder);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FolderResult {
	    data?: api.FolderDetail;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new FolderResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.FolderDetail);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FolderSettingsInput {
	    follow_redirects: string;
	    auth: api.Auth;
	    pre_script: string;
	    post_script: string;
	
	    static createFrom(source: any = {}) {
	        return new FolderSettingsInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.follow_redirects = source["follow_redirects"];
	        this.auth = this.convertValues(source["auth"], api.Auth);
	        this.pre_script = source["pre_script"];
	        this.post_script = source["post_script"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FormattedBody {
	    formatted: string;
	
	    static createFrom(source: any = {}) {
	        return new FormattedBody(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.formatted = source["formatted"];
	    }
	}
	export class FormattedBodyResult {
	    data?: FormattedBody;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new FormattedBodyResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], FormattedBody);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HistoryResponse {
	    status: number;
	    status_text: string;
	    content_type: string;
	    headers: engine.Header[];
	    body: string;
	    raw_body: string;
	    formatted: boolean;
	    preview_cut: boolean;
	    body_size: number;
	    stored_bytes: number;
	    stored_truncated: boolean;
	    media: string;
	    media_url: string;
	
	    static createFrom(source: any = {}) {
	        return new HistoryResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.status_text = source["status_text"];
	        this.content_type = source["content_type"];
	        this.headers = this.convertValues(source["headers"], engine.Header);
	        this.body = source["body"];
	        this.raw_body = source["raw_body"];
	        this.formatted = source["formatted"];
	        this.preview_cut = source["preview_cut"];
	        this.body_size = source["body_size"];
	        this.stored_bytes = source["stored_bytes"];
	        this.stored_truncated = source["stored_truncated"];
	        this.media = source["media"];
	        this.media_url = source["media_url"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HistoryRequestForm {
	    url: string;
	    headers: api.KeyValue[];
	    params: api.KeyValue[];
	    body: string;
	    body_type: string;
	    content_type: string;
	
	    static createFrom(source: any = {}) {
	        return new HistoryRequestForm(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.headers = this.convertValues(source["headers"], api.KeyValue);
	        this.params = this.convertValues(source["params"], api.KeyValue);
	        this.body = source["body"];
	        this.body_type = source["body_type"];
	        this.content_type = source["content_type"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HistorySummary {
	    id: number;
	    created_at: number;
	    project_id: string;
	    request_id: string;
	    request_name: string;
	    method: string;
	    url_template: string;
	    url_resolved: string;
	    env_name: string;
	    status: number;
	    duration_ms: number;
	    error: string;
	    resp_body_size: number;
	    resp_truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new HistorySummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.created_at = source["created_at"];
	        this.project_id = source["project_id"];
	        this.request_id = source["request_id"];
	        this.request_name = source["request_name"];
	        this.method = source["method"];
	        this.url_template = source["url_template"];
	        this.url_resolved = source["url_resolved"];
	        this.env_name = source["env_name"];
	        this.status = source["status"];
	        this.duration_ms = source["duration_ms"];
	        this.error = source["error"];
	        this.resp_body_size = source["resp_body_size"];
	        this.resp_truncated = source["resp_truncated"];
	    }
	}
	export class HistoryEntry {
	    summary: HistorySummary;
	    env_id: string;
	    template: HistoryRequestForm;
	    resolved: HistoryRequestForm;
	    response?: HistoryResponse;
	    hops: engine.Hop[];
	    auth?: api.Auth;
	    auth_source: string;
	    console?: scripting.Console;
	
	    static createFrom(source: any = {}) {
	        return new HistoryEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.summary = this.convertValues(source["summary"], HistorySummary);
	        this.env_id = source["env_id"];
	        this.template = this.convertValues(source["template"], HistoryRequestForm);
	        this.resolved = this.convertValues(source["resolved"], HistoryRequestForm);
	        this.response = this.convertValues(source["response"], HistoryResponse);
	        this.hops = this.convertValues(source["hops"], engine.Hop);
	        this.auth = this.convertValues(source["auth"], api.Auth);
	        this.auth_source = source["auth_source"];
	        this.console = this.convertValues(source["console"], scripting.Console);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HistoryEntryResult {
	    data?: HistoryEntry;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new HistoryEntryResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], HistoryEntry);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HistoryFilter {
	    project_id: string;
	    request_id: string;
	    query: string;
	    method: string;
	    status_class: string;
	    before_created: number;
	    before_id: number;
	    limit: number;
	
	    static createFrom(source: any = {}) {
	        return new HistoryFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.project_id = source["project_id"];
	        this.request_id = source["request_id"];
	        this.query = source["query"];
	        this.method = source["method"];
	        this.status_class = source["status_class"];
	        this.before_created = source["before_created"];
	        this.before_id = source["before_id"];
	        this.limit = source["limit"];
	    }
	}
	export class HistoryPage {
	    items: HistorySummary[];
	    has_more: boolean;
	
	    static createFrom(source: any = {}) {
	        return new HistoryPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], HistorySummary);
	        this.has_more = source["has_more"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HistoryPageResult {
	    data?: HistoryPage;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new HistoryPageResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], HistoryPage);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class HistorySettings {
	    max_entries: number;
	    max_response_bytes: number;
	
	    static createFrom(source: any = {}) {
	        return new HistorySettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.max_entries = source["max_entries"];
	        this.max_response_bytes = source["max_response_bytes"];
	    }
	}
	export class HistoryStorageInfo {
	    row_count: number;
	    total_bytes: number;
	
	    static createFrom(source: any = {}) {
	        return new HistoryStorageInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.row_count = source["row_count"];
	        this.total_bytes = source["total_bytes"];
	    }
	}
	export class HistoryStorageResult {
	    data?: HistoryStorageInfo;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new HistoryStorageResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], HistoryStorageInfo);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ImportFile {
	    path: string;
	    file_name: string;
	    kind: string;
	    name: string;
	    format: string;
	    folders: number;
	    requests: number;
	    variables: number;
	    servers: number;
	
	    static createFrom(source: any = {}) {
	        return new ImportFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.file_name = source["file_name"];
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.format = source["format"];
	        this.folders = source["folders"];
	        this.requests = source["requests"];
	        this.variables = source["variables"];
	        this.servers = source["servers"];
	    }
	}
	export class ImportFileResult {
	    data?: ImportFile;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new ImportFileResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], ImportFile);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ImportReportResult {
	    data?: importer.Report;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new ImportReportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], importer.Report);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class InvitationResult {
	    data?: api.Invitation;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new InvitationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.Invitation);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LegacyMigration {
	    pushed: number;
	    dropped: number;
	    failed: number;
	
	    static createFrom(source: any = {}) {
	        return new LegacyMigration(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pushed = source["pushed"];
	        this.dropped = source["dropped"];
	        this.failed = source["failed"];
	    }
	}
	export class LegacyMigrationResult {
	    data: LegacyMigration;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new LegacyMigrationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], LegacyMigration);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MemberAccessResult {
	    data?: api.MemberAccess;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new MemberAccessResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.MemberAccess);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MemberAccessViewResult {
	    data?: api.MemberAccessView;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new MemberAccessViewResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.MemberAccessView);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MetaResult {
	    data?: api.Meta;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new MetaResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.Meta);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MyInvitationListResult {
	    data: api.MyInvitation[];
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new MyInvitationListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.MyInvitation);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProjectAccessResult {
	    data?: api.ProjectAccess;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new ProjectAccessResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.ProjectAccess);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProjectAccessUserListResult {
	    data: api.ProjectAccessUser[];
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new ProjectAccessUserListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.ProjectAccessUser);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProjectListResult {
	    data: api.ProjectSummary[];
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new ProjectListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.ProjectSummary);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProjectResult {
	    data?: api.Project;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new ProjectResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.Project);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RequestListResult {
	    data: api.RequestSummary[];
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new RequestListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.RequestSummary);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RequestResult {
	    data?: api.Request;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new RequestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.Request);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RequestSummaryResult {
	    data?: api.RequestSummary;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new RequestSummaryResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.RequestSummary);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SavedFile {
	    path: string;
	    bytes_written: number;
	    truncated_at_cap: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SavedFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.bytes_written = source["bytes_written"];
	        this.truncated_at_cap = source["truncated_at_cap"];
	    }
	}
	export class SavedFileResult {
	    data?: SavedFile;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new SavedFileResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], SavedFile);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ScriptFolder {
	    name: string;
	    pre_script: string;
	    post_script: string;
	
	    static createFrom(source: any = {}) {
	        return new ScriptFolder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.pre_script = source["pre_script"];
	        this.post_script = source["post_script"];
	    }
	}
	export class SendOptions {
	    follow_redirects: boolean;
	    request_name: string;
	    auth?: api.Auth;
	    auth_source: string;
	    folders: ScriptFolder[];
	
	    static createFrom(source: any = {}) {
	        return new SendOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.follow_redirects = source["follow_redirects"];
	        this.request_name = source["request_name"];
	        this.auth = this.convertValues(source["auth"], api.Auth);
	        this.auth_source = source["auth_source"];
	        this.folders = this.convertValues(source["folders"], ScriptFolder);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SendResult {
	    data?: engine.Response;
	    error?: session.Problem;
	    unresolved: string[];
	    environment: string;
	    hops: engine.Hop[];
	    console?: scripting.Console;
	
	    static createFrom(source: any = {}) {
	        return new SendResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], engine.Response);
	        this.error = this.convertValues(source["error"], session.Problem);
	        this.unresolved = source["unresolved"];
	        this.environment = source["environment"];
	        this.hops = this.convertValues(source["hops"], engine.Hop);
	        this.console = this.convertValues(source["console"], scripting.Console);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Settings {
	    serverUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverUrl = source["serverUrl"];
	    }
	}
	export class TabRef {
	    kind: string;
	    id: string;
	
	    static createFrom(source: any = {}) {
	        return new TabRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.id = source["id"];
	    }
	}
	export class Tabs {
	    open: TabRef[];
	    active: TabRef;
	
	    static createFrom(source: any = {}) {
	        return new Tabs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.open = this.convertValues(source["open"], TabRef);
	        this.active = this.convertValues(source["active"], TabRef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TeamInvitationListResult {
	    data: api.TeamInvitation[];
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new TeamInvitationListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.TeamInvitation);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TeamListResult {
	    data: api.TeamSummary[];
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new TeamListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.TeamSummary);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TeamRefResult {
	    data?: api.TeamRef;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new TeamRefResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.TeamRef);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TeamResult {
	    data?: api.Team;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new TeamResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.Team);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UIPrefs {
	    sidebar_width: number;
	    response_wrap: boolean;
	    bulk_params: boolean;
	    bulk_headers: boolean;
	    bulk_form: boolean;
	
	    static createFrom(source: any = {}) {
	        return new UIPrefs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sidebar_width = source["sidebar_width"];
	        this.response_wrap = source["response_wrap"];
	        this.bulk_params = source["bulk_params"];
	        this.bulk_headers = source["bulk_headers"];
	        this.bulk_form = source["bulk_form"];
	    }
	}
	export class VariableResult {
	    data?: api.Variable;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new VariableResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.Variable);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class VariableViewListResult {
	    data: envs.VariableView[];
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new VariableViewListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], envs.VariableView);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WebhookListResult {
	    data: api.Webhook[];
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new WebhookListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.Webhook);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WebhookPanelPrefs {
	    expanded: boolean;
	    fraction: number;
	
	    static createFrom(source: any = {}) {
	        return new WebhookPanelPrefs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.expanded = source["expanded"];
	        this.fraction = source["fraction"];
	    }
	}
	export class WebhookPatchInput {
	    name?: string;
	    domain?: string;
	    resp_status?: number;
	    resp_headers?: api.KeyValue[];
	    resp_body?: string;
	
	    static createFrom(source: any = {}) {
	        return new WebhookPatchInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.domain = source["domain"];
	        this.resp_status = source["resp_status"];
	        this.resp_headers = this.convertValues(source["resp_headers"], api.KeyValue);
	        this.resp_body = source["resp_body"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WebhookResult {
	    data?: api.WebhookDetail;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new WebhookResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], api.WebhookDetail);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WorkspaceResult {
	    data?: workspace.Workspace;
	    error?: session.Problem;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = this.convertValues(source["data"], workspace.Workspace);
	        this.error = this.convertValues(source["error"], session.Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace scripting {
	
	export class Entry {
	    owner: string;
	    phase: string;
	    level: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.owner = source["owner"];
	        this.phase = source["phase"];
	        this.level = source["level"];
	        this.text = source["text"];
	    }
	}
	export class Console {
	    entries: Entry[];
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Console(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = this.convertValues(source["entries"], Entry);
	        this.truncated = source["truncated"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Doc {
	    group: string;
	    name: string;
	    usage: string;
	    summary: string;
	    example: string;
	    where: string;
	
	    static createFrom(source: any = {}) {
	        return new Doc(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.group = source["group"];
	        this.name = source["name"];
	        this.usage = source["usage"];
	        this.summary = source["summary"];
	        this.example = source["example"];
	        this.where = source["where"];
	    }
	}

}

export namespace session {
	
	export class AuthState {
	    state: string;
	    user?: api.User;
	    serverUrl: string;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new AuthState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.state = source["state"];
	        this.user = this.convertValues(source["user"], api.User);
	        this.serverUrl = source["serverUrl"];
	        this.message = source["message"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Problem {
	    kind: string;
	    status?: number;
	    code?: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new Problem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.status = source["status"];
	        this.code = source["code"];
	        this.message = source["message"];
	    }
	}
	export class Result {
	    state: AuthState;
	    error?: Problem;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.state = this.convertValues(source["state"], AuthState);
	        this.error = this.convertValues(source["error"], Problem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace workspace {
	
	export class Workspace {
	    teams: api.TeamSummary[];
	    team_id: string;
	    projects: api.ProjectSummary[];
	    project_id: string;
	
	    static createFrom(source: any = {}) {
	        return new Workspace(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.teams = this.convertValues(source["teams"], api.TeamSummary);
	        this.team_id = source["team_id"];
	        this.projects = this.convertValues(source["projects"], api.ProjectSummary);
	        this.project_id = source["project_id"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}


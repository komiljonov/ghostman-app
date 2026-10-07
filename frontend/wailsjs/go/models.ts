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
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
	    }
	}
	export class FolderDetail {
	    id: string;
	    project_id: string;
	    parent_id?: string;
	    name: string;
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
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
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
	    sort_order: number;
	    created_at: string;
	    updated_at: string;
	    headers: KeyValue[];
	    query_params: KeyValue[];
	    body: RequestBody;
	
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
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.headers = this.convertValues(source["headers"], KeyValue);
	        this.query_params = this.convertValues(source["query_params"], KeyValue);
	        this.body = this.convertValues(source["body"], RequestBody);
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
	        this.sort_order = source["sort_order"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
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
	
	    static createFrom(source: any = {}) {
	        return new EnvContext(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.environments = this.convertValues(source["environments"], api.Environment);
	        this.active_id = source["active_id"];
	        this.active_name = source["active_name"];
	        this.variables = this.convertValues(source["variables"], VariableView);
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
	export class RedirectSetting {
	    mode: string;
	    default: boolean;
	    effective: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RedirectSetting(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.default = source["default"];
	        this.effective = source["effective"];
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
	export class SendResult {
	    data?: engine.Response;
	    error?: session.Problem;
	    unresolved: string[];
	    environment: string;
	    hops: engine.Hop[];
	
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
	
	    static createFrom(source: any = {}) {
	        return new UIPrefs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sidebar_width = source["sidebar_width"];
	        this.response_wrap = source["response_wrap"];
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


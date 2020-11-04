## Introduction
A simple yet powerful, fully customizable and versatile load balancer and message passing interface in `Node.js` and `WebSocket`

## How to use Locally (Example):

`Step 1:` Run this server in seperate terminal:

```bash
cd load-balancer
export IP=127.0.0.1 # Replace with your preferred IP
export PORT=80 # Replace with your preferred PORT
node index
```

`Step 2:` Any upstream server must connect to this channel via:

```javascript
const io = require('socket-io-client')
const lbSocket = io.connect('http://127.0.0.1:80/list', { path: '/list' }) // replace with <ip:port of load balancer>
```

As a result, those servers will be dynamically attached to/detached from the whole load balancing pool

`Step 3:` Now, the upstream server must emit a signal `address` with his own ipv4 address and port via:

```javascript
server.on('listening', () => {
	const { address: ip, port } = server.address()
	lbSocket.emit('address', `http://{ip}:{port}`) // Also, you can set those hardcoded or via `ENVIRONMENT VARIABLE`
})
```

Now, the load balancer knows to which IP and Port to pass request.

This is the minimum config required for load balancing.

____________________________
If you have stateful servers to sync with each other, follow these steps:

`Step 4:`
| Signal to emit	| If																																			 |
| --------------	| ------------------------------------------------------------------------ |
|`subs_exists`		| You want to query if a user exists in any of the upstreams							 |
|`join_subs`			| If you want to share joined subscriber username between upstream servers |
|`leave_subs`			| If you want to share left subscriber username between upstream servers	 |

## Technical Details:

> Let, There are,
	>> - M number of users
	>> - N number of backend servers which are statefull

Let's assume:

> | User 			| Server connected to |
> | --------:	| ------------------- |
> | sadman		|	:3001								|
> | alif			|	:3001								|
> | ihsan			|	:3002								|
> | ahsan			|	:3003								|
> | baki			|	:3003								|
	
In typical implementation:

> |	User			 |	Can send/receive message to/from |
> |	---------: | -------------------------------- |
> |	sadman		 |	alif														 |
> |	alif			 |	sadman													 |
> |	ihsan			 |																	 |
> |	ahsan			 |	baki														 |
> |	baki			 |	ahsan														 |
	
In my implementation:

> |	User		 |	Can send/receive message to/from |
> |	-------- | --------------------------------	 |
> |	anyone	 |	anyone													 |

Obviously, we can implement access control or room isolation.

## Principles (index.js):
> User opens the link in browser and requests
>
> The request hits `reverse proxy` like nginx, haproxy, apache etc.
	>> The request gets fowarded to `custom load balancer` server in node js
		>>> The `custom load balancer` server forwards the request to any of the backend servers using LB algorithm
		>>>
		>>> The `custom load balancer` is also connected to all of the backend servers via secret websocket channel
		>>>
		>>> The user gets connected to the forwarded backend via websocket
			>>>> The user sends a username request
			>>>>
			>>>> The server checks if the id exists in other servers or not
		>>>
		>>> The backend server sends the validated user id and it's own info to `custom load balancer`
		>>>
		>>> Thus, the `custom load balancer` keeps track of connected websockets throughout the backends
		>>>
		>>> If there's a message, the `custom load balancer` uses `proxy` to:
			>>>> | Forwards to	 							| If												 		|
			>>>> | -------------------------	| ----------------------------- |
			>>>> | all backends								| it's a public message					|
			>>>> | the corresponding backend	| it's to a specific client			|
			>>>> | any other backend					| corresponding backend is down	|
		>>>
		>>> If it's not a message, then `custom load balancer` uses Load Balancing algorithm to determine which backend to choose

## Principles (Easy to Implement):
> User opens the link in browser and requests
>
> The request hits `reverse proxy` and `load balancer` like nginx, haproxy, apache etc. The `reverse proxy` is disabled on stateful paths
	>> A `tracker` server is always connected to all the backend servers via websocket keeping track of them
		>>> Due to `load balancer`, requests get forwarded to any of the backend servers using LB algorithm
		>>>
		>>> The user gets connected to the `tracker` via websocket
		>>>
		>>> The `tracker` sends all the connected backend servers info to the user
		>>>
		>>> If a server disconnects, the `tracker` sends the info as well
		>>>
		>>> Thus, the user keeps track of connected backends and listens to all the servers

## Principles (tracker.js):
> User opens the link in browser and requests
>
> The request hits `reverse proxy` and `load balancer` like nginx, haproxy, apache etc. The `reverse proxy` is disabled on stateful paths
	>> A `tracker` server is always connected to all the backend servers via websocket keeping track of them
		>>> Due to `load balancer`, requests get forwarded to any of the backend servers using LB algorithm
		>>>
		>>> The user gets connected to that random server
		>>>
		>>> If a user sends a message via a channel distributed through multiple servers, he:
			>>>> | #		| Broadcasts	by						| To											 					|
			>>>> | ---	| -------------------------	| ---------------------------------	|
			>>>> | 1		| himself										| inside the server he is connected	|
			>>>> | 2		| the tracker								| to all the other servers					|
		>>>
	>>
	>> If a server disconnects, the `tracker` sends the info to all the other servers
